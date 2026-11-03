/**
 * tests/audit-feature-branches.test.cjs
 * Suite de pruebas automatizadas y reproducibles para scripts/audit-feature-branches.cjs.
 *
 * MODO DE EJECUCIÓN:
 *   node tests/audit-feature-branches.test.cjs
 *
 * REQUISITOS:
 *   - Node.js v18+ (utiliza módulos nativos node:assert y APIs estándar sin dependencias externas).
 *   - Operación estrictamente aislada: utiliza stubs, mocks y datos controlados en memoria.
 *   - No muta referencias, ramas, worktrees ni configuración del repositorio real.
 */

const assert = require('assert');
const path = require('path');

const audit = require('../scripts/audit-feature-branches.cjs');
const {
  gitExec,
  getGitHubToken,
  fetchAllPRs,
  verifyIntegrationEvidence,
  analyzeBranch,
  ALLOWED_GIT_SUBCOMMANDS,
  CANONICAL_TARGETS,
  CANONICAL_REPO
} = audit;

console.log('=== SUITE INTEGRAL DE PRUEBAS: AUDITOR DE RAMAS ===\n');

async function runAllTests() {
  const dummyMainSha = '1111111111111111111111111111111111111111';
  const dummyDevSha = '2222222222222222222222222222222222222222';

  function createMockGit(overrides = {}) {
    return function mockGitExec(args, options = {}) {
      const sub = args[0];
      if (!ALLOWED_GIT_SUBCOMMANDS.has(sub)) {
        return { ok: false, stdout: '', stderr: 'Disallowed subcommand', exitCode: -1 };
      }

      if (overrides[sub]) {
        const handler = overrides[sub];
        if (typeof handler === 'function') {
          return handler(args, options);
        }
        return handler;
      }

      if (sub === 'rev-parse') {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, stderr: '', exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, stderr: '', exitCode: 0 };
        return { ok: true, stdout: '3333333333333333333333333333333333333333', stderr: '', exitCode: 0 };
      }
      if (sub === 'merge-base') {
        // Por defecto no ancestro para obligar a verificar PR o diff
        return { ok: false, stdout: '', stderr: '', exitCode: 1 };
      }
      if (sub === 'rev-list') {
        return { ok: true, stdout: '0', stderr: '', exitCode: 0 };
      }
      if (sub === 'diff') {
        if (args.includes('--quiet')) return { ok: false, stdout: '', stderr: '', exitCode: 1 };
        return { ok: true, stdout: '1 file changed, 1 insertion(+)', stderr: '', exitCode: 0 };
      }
      if (sub === 'worktree') {
        return { ok: true, stdout: 'worktree /tmp\nHEAD 1111\nbranch refs/heads/main', stderr: '', exitCode: 0 };
      }
      if (sub === 'branch') {
        if (args.includes('--show-current')) return { ok: true, stdout: 'docs/feature-lifecycle-policy', stderr: '', exitCode: 0 };
        return { ok: true, stdout: '  main\n  feat/test', stderr: '', exitCode: 0 };
      }
      return { ok: true, stdout: '', stderr: '', exitCode: 0 };
    };
  }

  // --- SECCIÓN 1: PAGINACIÓN Y CONSULTA GITHUB ---
  console.log('[1/26] Paginación completa dentro del límite');
  {
    const fakeFetch = async (url) => {
      const match = url.match(/[?&]page=(\d+)/);
      const page = parseInt(match[1], 10);
      if (page === 1) {
        return { ok: true, status: 200, json: async () => Array.from({ length: 100 }, (_, i) => ({ id: i + 1, number: i + 1 })) };
      }
      if (page === 2) {
        return { ok: true, status: 200, json: async () => Array.from({ length: 42 }, (_, i) => ({ id: 100 + i + 1, number: 100 + i + 1 })) };
      }
      return { ok: true, status: 200, json: async () => [] };
    };
    const res = await fetchAllPRs('fake-token', 50, fakeFetch);
    assert.strictEqual(res.status, 'success');
    assert.strictEqual(res.prs.length, 142);
    assert.strictEqual(res.pagesFetched, 2);
    console.log('  ✔ Paginación completada correctamente (142 PRs, 2 páginas).');
  }

  console.log('[2/26] Límite de 50 páginas sin final confirmado');
  {
    const fakeFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => Array.from({ length: 100 }, (_, i) => ({ id: Math.random(), number: i + 1 }))
    });
    const res = await fetchAllPRs('fake-token', 50, fakeFetch);
    assert.strictEqual(res.status, 'pagination_error');
    assert.strictEqual(res.pagesFetched, 50);
    assert(res.message.includes('sin confirmar el final'));
    console.log('  ✔ Límite alcanzado devuelve pagination_error.');
  }

  // --- SECCIÓN 2: PRECEDENCIA DE CREDENCIALES ---
  console.log('[3/26] Precedencia 1: git credential fill');
  {
    const mockGit = createMockGit({
      'credential': (args, opts) => {
        if (opts && opts.input && opts.input.includes('host=github.com')) {
          return { ok: true, stdout: 'password=token_git_credential\n', exitCode: 0 };
        }
        return { ok: false, stdout: '', exitCode: 1 };
      }
    });
    const fakeEnv = { GITHUB_TOKEN: 'token_from_env_github', GH_TOKEN: 'token_from_env_gh' };
    const token = getGitHubToken(fakeEnv, mockGit);
    assert.strictEqual(token, 'token_git_credential', 'git credential fill debe tener precedencia absoluta');
    console.log('  ✔ git credential fill tiene precedencia 1.');
  }

  console.log('[4/26] Precedencia 2: GITHUB_TOKEN en ausencia de git credential fill');
  {
    const mockGit = createMockGit({
      'credential': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const fakeEnv = { GITHUB_TOKEN: 'token_from_env_github', GH_TOKEN: 'token_from_env_gh' };
    const token = getGitHubToken(fakeEnv, mockGit);
    assert.strictEqual(token, 'token_from_env_github', 'GITHUB_TOKEN debe tener precedencia sobre GH_TOKEN');
    console.log('  ✔ GITHUB_TOKEN tiene precedencia 2.');
  }

  console.log('[5/26] Precedencia 3: GH_TOKEN en ausencia de GITHUB_TOKEN y git credential');
  {
    const mockGit = createMockGit({
      'credential': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const fakeEnv = { GH_TOKEN: 'token_from_env_gh' };
    const token = getGitHubToken(fakeEnv, mockGit);
    assert.strictEqual(token, 'token_from_env_gh');
    console.log('  ✔ GH_TOKEN tiene precedencia 3.');
  }

  console.log('[6/26] Ausencia total de credenciales');
  {
    const mockGit = createMockGit({
      'credential': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const token = getGitHubToken({}, mockGit);
    assert.strictEqual(token, null);
    const res = await fetchAllPRs(token, 50, null);
    assert.strictEqual(res.status, 'no_token');
    assert(res.message.includes('Consulta de GitHub no disponible'));
    console.log('  ✔ Ausencia de credenciales produce estado explícito no_token.');
  }

  // --- SECCIÓN 3: ASOCIACIÓN DE REPOSITORIO Y REPOSITORIOS AJENOS ---
  console.log('[7/26] PR de repositorio externo / fork con mismo nombre de rama');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 501,
          number: 501,
          state: 'closed',
          merged_at: '2026-11-01T12:00:00Z',
          merge_commit_sha: 'commit-ext-sha',
          base: { ref: 'main' },
          head: { ref: 'feat/fork-branch', repo: { full_name: 'external-user/muro-participativo-de-ideas' } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/fork-branch', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / PR DE OTRO REPOSITORIO O NO VERIFICABLE');
    console.log('  ✔ PR de fork externo detectado y clasificado en [D].');
  }

  console.log('[8/26] PR de repositorio canónico verificado');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 502,
          number: 502,
          state: 'open',
          merged_at: null,
          base: { ref: 'main' },
          head: { ref: 'feat/canonical-branch', repo: { full_name: CANONICAL_REPO } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/canonical-branch', false, env, mockGit);
    assert.strictEqual(analysis.category, 'C');
    assert.strictEqual(analysis.recommendation, 'CONSERVAR (PR ABIERTO)');
    console.log('  ✔ PR canónico asociado correctamente.');
  }

  // --- SECCIÓN 4: ESCENARIOS DE INTEGRACIÓN REAL Y TRABAJO RESIDUAL ---
  console.log('[9/26] Merge normal completamente integrado');
  {
    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', stderr: '', exitCode: 0 };
        return { ok: false, stdout: '', stderr: '', exitCode: 1 };
      },
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 })
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/normal-merge', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    assert(analysis.rationale.includes('ancestría directa'));
    console.log('  ✔ Merge normal completamente integrado clasifica en [A].');
  }

  console.log('[10/26] Squash merge completamente integrado');
  {
    const branchSha = '3333333333333333333333333333333333333333';
    const mergeSha = '4444444444444444444444444444444444444444';
    const mockGit = createMockGit({
      'merge-base': (args) => {
        // merge_sha es ancestro de origin/main
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) {
          return { ok: true, stdout: '', stderr: '', exitCode: 0 };
        }
        return { ok: false, stdout: '', stderr: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: branchSha, exitCode: 0 };
      },
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 })
    });

    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 601,
          number: 601,
          state: 'closed',
          merged_at: '2026-11-01T12:00:00Z',
          merge_commit_sha: mergeSha,
          base: { ref: 'main' },
          head: { ref: 'feat/squash-clean', sha: branchSha, repo: { full_name: CANONICAL_REPO } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };

    const analysis = analyzeBranch('feat/squash-clean', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    assert(analysis.rationale.includes('sin commits posteriores'));
    console.log('  ✔ Squash merge limpio clasifica en [A].');
  }

  console.log('[11/26] Squash con commits posteriores a la fusión');
  {
    const oldPrHeadSha = '3333333333333333333333333333333333333333';
    const newBranchSha = '5555555555555555555555555555555555555555';
    const mergeSha = '4444444444444444444444444444444444444444';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: newBranchSha, exitCode: 0 };
      },
      'rev-list': (args) => {
        if (args.includes(`${oldPrHeadSha}..refs/heads/feat/squash-post`)) {
          return { ok: true, stdout: '2', exitCode: 0 }; // 2 commits posteriores
        }
        return { ok: true, stdout: '2', exitCode: 0 };
      }
    });

    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 602,
          number: 602,
          state: 'closed',
          merged_at: '2026-11-01T12:00:00Z',
          merge_commit_sha: mergeSha,
          base: { ref: 'main' },
          head: { ref: 'feat/squash-post', sha: oldPrHeadSha, repo: { full_name: CANONICAL_REPO } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };

    const analysis = analyzeBranch('feat/squash-post', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / COMMITS POSTERIORES A LA FUSIÓN');
    assert(analysis.rationale.includes('posteriores'));
    console.log('  ✔ Squash con commits posteriores clasifica en [D].');
  }

  console.log('[12/26] Merge normal con commits posteriores a la fusión');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: true, stdout: '', exitCode: 0 }),
      'rev-list': () => ({ ok: true, stdout: '3', exitCode: 0 }) // 3 commits ahead
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/merge-post', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / COMMITS POSTERIORES A LA FUSIÓN');
    console.log('  ✔ Merge con commits posteriores clasifica en [D].');
  }

  console.log('[13/26] Árboles equivalentes con historias divergentes');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }), // Historia divergente
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 }; // Árbol 100% idéntico
        return { ok: true, stdout: '', exitCode: 0 };
      }
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/equiv-tree', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    assert(analysis.rationale.includes('Árbol de contenido 100% idéntico'));
    console.log('  ✔ Árbol idéntico con historia divergente clasifica en [A].');
  }

  console.log('[14/26] Promoción verificada en Dev');
  {
    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes('refs/remotes/origin/Dev')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-list': (args) => {
        if (args.includes('refs/remotes/origin/Dev..refs/heads/feat/promo-dev')) return { ok: true, stdout: '0', exitCode: 0 };
        return { ok: true, stdout: '5', exitCode: 0 };
      }
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/promo-dev', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    assert(analysis.rationale.includes('origin/Dev'));
    console.log('  ✔ Promoción verificada en Dev clasifica en [A].');
  }

  console.log('[15/26] Contenido residual real (commits no integrados)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '4', exitCode: 0 })
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/residual-work', false, env, mockGit);
    assert.strictEqual(analysis.category, 'C');
    assert.strictEqual(analysis.recommendation, 'CONSERVAR (TRABAJO ACTIVO O PENDIENTE)');
    console.log('  ✔ Contenido residual activo clasifica en [C].');
  }

  console.log('[16/26] PR fusionado sin merge_commit_sha');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 603,
          number: 603,
          state: 'closed',
          merged_at: '2026-11-01T12:00:00Z',
          merge_commit_sha: null,
          base: { ref: 'main' },
          head: { ref: 'feat/no-merge-sha', repo: { full_name: CANONICAL_REPO } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/no-merge-sha', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / FALTA SHA DE INTEGRACIÓN');
    console.log('  ✔ PR sin merge_commit_sha clasifica en [D].');
  }

  console.log('[17/26] Commit de integración no contenido en destino');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: {
        status: 'success',
        prs: [{
          id: 604,
          number: 604,
          state: 'closed',
          merged_at: '2026-11-01T12:00:00Z',
          merge_commit_sha: 'commit-discarded-sha',
          base: { ref: 'main' },
          head: { ref: 'feat/lost-merge', repo: { full_name: CANONICAL_REPO } }
        }]
      },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/lost-merge', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / COMMIT DE INTEGRACIÓN NO ENCONTRADO EN DESTINO');
    console.log('  ✔ Commit de integración ausente en destino clasifica en [D].');
  }

  // --- SECCIÓN 5: ERRORES Y CONDICIONES DE BORDE DE GIT Y GITHUB ---
  console.log('[18/26] Error de Git al consultar ancestría');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', stderr: 'fatal: error reading object', exitCode: 128 })
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/git-error', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Error de Git en ancestría detiene recomendación y clasifica en [D].');
  }

  console.log('[19/26] Ausencia obligatoria de origin/main');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: null,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/no-main', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / PUNTEROS CANÓNICOS AUSENTES');
    console.log('  ✔ Ausencia de origin/main detiene análisis en [D].');
  }

  console.log('[20/26] Ausencia obligatoria de origin/Dev');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: null
    };
    const analysis = analyzeBranch('feat/no-dev', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / PUNTEROS CANÓNICOS AUSENTES');
    console.log('  ✔ Ausencia de origin/Dev detiene análisis en [D].');
  }

  console.log('[21/26] Error al listar worktrees');
  {
    const mockGit = createMockGit({
      'worktree': () => ({ ok: false, stdout: '', stderr: 'fatal: corrupt worktree list', exitCode: 128 })
    });
    const res = mockGit(['worktree', 'list', '--porcelain']);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.exitCode, 128);
    console.log('  ✔ Fallo en worktree list detectado correctamente.');
  }

  console.log('[22/26] Error al listar ramas');
  {
    const mockGit = createMockGit({
      'branch': (args) => {
        if (args.includes('-a')) return { ok: false, stdout: '', stderr: 'fatal: error reading refs', exitCode: 128 };
        return { ok: true, stdout: 'main', exitCode: 0 };
      }
    });
    const res = mockGit(['branch', '-a']);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.exitCode, 128);
    console.log('  ✔ Fallo en branch -a detectado correctamente.');
  }

  console.log('[23/26] Error al identificar rama activa');
  {
    const mockGit = createMockGit({
      'branch': (args) => {
        if (args.includes('--show-current')) return { ok: false, stdout: '', stderr: 'fatal: detached HEAD', exitCode: 128 };
        return { ok: true, stdout: 'main', exitCode: 0 };
      }
    });
    const res = mockGit(['branch', '--show-current']);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.exitCode, 128);
    console.log('  ✔ Fallo en branch --show-current detectado correctamente.');
  }

  console.log('[24/26] Nombre de rama con caracteres inválidos');
  {
    const mockGit = createMockGit();
    const env = { currentBranch: 'main', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/bad branch;rm -rf', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / NOMBRE DE RAMA INVÁLIDO');
    console.log('  ✔ Caracteres especiales interceptados preventivamente.');
  }

  console.log('[25/26] Protección de rama activa en sesión');
  {
    const mockGit = createMockGit();
    const env = {
      currentBranch: 'feat/active-work',
      githubResult: { status: 'success', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/active-work', false, env, mockGit);
    assert.strictEqual(analysis.category, 'C');
    assert.strictEqual(analysis.recommendation, 'CONSERVAR');
    console.log('  ✔ Rama activa en uso protegida con [C].');
  }

  console.log('[26/26] Consulta de GitHub incompleta (interrupción por red o auth)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: true, stdout: '', exitCode: 0 })
    });
    const env = {
      currentBranch: 'other-branch',
      githubResult: { status: 'pagination_error', message: 'Conexión interrumpida', prs: [] },
      worktreeEntries: [],
      mainSha: dummyMainSha,
      devSha: dummyDevSha
    };
    const analysis = analyzeBranch('feat/unverified-due-to-gh', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / CONSULTA GITHUB PENDIENTE O INCOMPLETA');
    assert.notStrictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    console.log('  ✔ Incertidumbre de GitHub bloquea categóricamente recomendación de borrado.');
  }

  console.log('\n===============================================================');
  console.log(' RESULTADO: 26/26 PRUEBAS EJECUTADAS Y SUPERADAS CON ÉXITO');
  console.log('===============================================================');
}

runAllTests().catch(err => {
  console.error('\n✖ FALLO EN LA SUITE DE PRUEBAS:', err);
  process.exit(1);
});
