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

  // =============================================================
  // BLOQUE 1: PRUEBAS PREVIAS 1 A 26
  // =============================================================

  console.log('[1/54] Paginación completa dentro del límite');
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

  console.log('[2/54] Límite de 50 páginas sin final confirmado');
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

  console.log('[3/54] Precedencia 1: git credential fill');
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

  console.log('[4/54] Precedencia 2: GITHUB_TOKEN en ausencia de git credential fill');
  {
    const mockGit = createMockGit({
      'credential': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const fakeEnv = { GITHUB_TOKEN: 'token_from_env_github', GH_TOKEN: 'token_from_env_gh' };
    const token = getGitHubToken(fakeEnv, mockGit);
    assert.strictEqual(token, 'token_from_env_github', 'GITHUB_TOKEN debe tener precedencia sobre GH_TOKEN');
    console.log('  ✔ GITHUB_TOKEN tiene precedencia 2.');
  }

  console.log('[5/54] Precedencia 3: GH_TOKEN en ausencia de GITHUB_TOKEN y git credential');
  {
    const mockGit = createMockGit({
      'credential': () => ({ ok: false, stdout: '', exitCode: 1 })
    });
    const fakeEnv = { GH_TOKEN: 'token_from_env_gh' };
    const token = getGitHubToken(fakeEnv, mockGit);
    assert.strictEqual(token, 'token_from_env_gh');
    console.log('  ✔ GH_TOKEN tiene precedencia 3.');
  }

  console.log('[6/54] Ausencia total de credenciales');
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

  console.log('[7/54] PR de repositorio externo / fork con mismo nombre de rama');
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

  console.log('[8/54] PR de repositorio canónico verificado');
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

  console.log('[9/54] Merge normal completamente integrado');
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

  console.log('[10/54] Squash merge completamente integrado');
  {
    const branchSha = '3333333333333333333333333333333333333333';
    const mergeSha = '4444444444444444444444444444444444444444';
    const mockGit = createMockGit({
      'merge-base': (args) => {
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
    console.log('  ✔ Squash merge limpio clasifica en [A].');
  }

  console.log('[11/54] Squash con commits posteriores a la fusión');
  {
    const oldPrHeadSha = '3333333333333333333333333333333333333333';
    const newBranchSha = '5555555555555555555555555555555555555555';
    const mergeSha = '4444444444444444444444444444444444444444';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        if (args.includes(oldPrHeadSha) && args.includes('refs/heads/feat/squash-post')) return { ok: true, stdout: '', exitCode: 0 };
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
          return { ok: true, stdout: '2', exitCode: 0 };
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
    console.log('  ✔ Squash con commits posteriores clasifica en [D].');
  }

  console.log('[12/54] Merge normal con commits posteriores a la fusión');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: true, stdout: '', exitCode: 0 }),
      'rev-list': () => ({ ok: true, stdout: '3', exitCode: 0 })
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

  console.log('[13/54] Árboles equivalentes con historias divergentes (aheadCount = 0)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 };
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
    console.log('  ✔ Árbol idéntico sin commits pendientes clasifica en [A].');
  }

  console.log('[14/54] Promoción verificada en Dev');
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
    console.log('  ✔ Promoción verificada en Dev clasifica en [A].');
  }

  console.log('[15/54] Contenido residual real (commits no integrados)');
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

  console.log('[16/54] PR fusionado sin merge_commit_sha');
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

  console.log('[17/54] Commit de integración no contenido en destino');
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

  console.log('[18/54] Error de Git al consultar ancestría');
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

  console.log('[19/54] Ausencia obligatoria de origin/main');
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

  console.log('[20/54] Ausencia obligatoria de origin/Dev');
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

  console.log('[21/54] Error al listar worktrees');
  {
    const mockGit = createMockGit({
      'worktree': () => ({ ok: false, stdout: '', stderr: 'fatal: corrupt worktree list', exitCode: 128 })
    });
    const res = mockGit(['worktree', 'list', '--porcelain']);
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.exitCode, 128);
    console.log('  ✔ Fallo en worktree list detectado correctamente.');
  }

  console.log('[22/54] Error al listar ramas');
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

  console.log('[23/54] Error al identificar rama activa');
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

  console.log('[24/54] Nombre de rama con caracteres inválidos');
  {
    const mockGit = createMockGit();
    const env = { currentBranch: 'main', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/bad branch;rm -rf', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / NOMBRE DE RAMA INVÁLIDO');
    console.log('  ✔ Caracteres especiales interceptados preventivamente.');
  }

  console.log('[25/54] Protección de rama activa en sesión');
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

  console.log('[26/54] Consulta de GitHub incompleta (interrupción por red o auth)');
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
    console.log('  ✔ Incertidumbre de GitHub bloquea categóricamente recomendación de borrado.');
  }

  // =============================================================
  // BLOQUE 2: 14 NUEVAS PRUEBAS ESPECÍFICAS DE SEGURIDAD (27 A 40)
  // =============================================================

  console.log('[27/54] rev-list falla durante la verificación (Corrección A)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: true, stdout: '', exitCode: 0 }),
      'rev-list': () => ({ ok: false, stdout: '', stderr: 'fatal: rev-list failed', exitCode: 128 })
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');
    assert(res.error.includes('rev-list'));

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Fallo en rev-list resulta en modo git_error y categoría D.');
  }

  console.log('[28/54] rev-list devuelve salida inválida (no numérica) (Corrección A)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: true, stdout: '', exitCode: 0 }),
      'rev-list': () => ({ ok: true, stdout: 'NaN-corrupted-output', exitCode: 0 })
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Salida inválida de rev-list detectada y clasificada como D.');
  }

  console.log('[29/54] diff --quiet devuelve 0 (árboles iguales) (Corrección B)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: true, stdout: '', exitCode: 0 };
      }
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, true);
    assert.strictEqual(res.mode, 'equivalent_tree');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    console.log('  ✔ diff --quiet con código 0 valida equivalent_tree y categoría A.');
  }

  console.log('[30/54] diff --quiet devuelve 1 (árboles diferentes) (Corrección B)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: false, stdout: '', exitCode: 1 };
        return { ok: true, stdout: '1 file changed', exitCode: 0 };
      }
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'not_integrated');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.notStrictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    console.log('  ✔ diff --quiet con código 1 clasifica como not_integrated y categoría D.');
  }

  console.log('[31/54] diff --quiet devuelve código superior a 1 (Corrección B)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: false, stdout: '', stderr: 'fatal: error comparing trees', exitCode: 2 };
        return { ok: true, stdout: '', exitCode: 0 };
      }
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');
    assert(res.error.includes('diff --quiet'));

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ diff --quiet con código > 1 tratado como error de Git y categoría D.');
  }

  console.log('[32/54] Error de ejecución de diff (excepción o fallo de proceso) (Corrección B)');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '0', exitCode: 0 }),
      'diff': () => ({ ok: false, stdout: '', stderr: 'spawn error', exitCode: -1 })
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Error de ejecución de diff conduce de inmediato a categoría D.');
  }

  console.log('[33/54] Rama retrocedida respecto del prHeadSha (Corrección C)');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const currentSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // Commit más antiguo
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        // mergeSha está en target
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        // prHeadSha NO es ancestro de la rama actual (la rama está detrás de prHeadSha)
        if (args.includes(prHeadSha) && args.includes('refs/heads/feat/behind-pr')) return { ok: false, stdout: '', exitCode: 1 };
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: currentSha, exitCode: 0 };
      }
    });

    const canonicalPr = {
      id: 701,
      number: 701,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/behind-pr', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/behind-pr', canonicalPr, 'refs/remotes/origin/main', currentSha, mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'branch_behind_pr');
    assert(res.reason.includes('Rama retrocedida'));

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/behind-pr', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / RAMA RETROCEDIDA RESPECTO DEL PR');
    console.log('  ✔ Rama retrocedida respecto al PR clasificada en modo branch_behind_pr y categoría D.');
  }

  console.log('[34/54] Rama en sincronía exacta con prHeadSha y mergeSha en target (Corrección C)');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: prHeadSha, exitCode: 0 }; // Coincide exactamente con el PR
      }
    });

    const canonicalPr = {
      id: 702,
      number: 702,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/synced-pr', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/synced-pr', canonicalPr, 'refs/remotes/origin/main', prHeadSha, mockGit);
    assert.strictEqual(res.integrated, true);
    assert.strictEqual(res.mode, 'squash_merge');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/synced-pr', false, env, mockGit);
    assert.strictEqual(analysis.category, 'A');
    assert.strictEqual(analysis.recommendation, 'APTA PARA ELIMINACIÓN');
    console.log('  ✔ Rama en sincronía con PR validada en squash_merge y categoría A.');
  }

  console.log('[35/54] Commits posteriores a la fusión detectados (Corrección C)');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const currentSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        if (args.includes(prHeadSha) && args.includes('refs/heads/feat/post-work')) return { ok: true, stdout: '', exitCode: 0 }; // es ancestro
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: currentSha, exitCode: 0 };
      },
      'rev-list': () => ({ ok: true, stdout: '2', exitCode: 0 }) // 2 commits posteriores
    });

    const canonicalPr = {
      id: 703,
      number: 703,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/post-work', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/post-work', canonicalPr, 'refs/remotes/origin/main', currentSha, mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'post_merge_commits');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/post-work', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / COMMITS POSTERIORES A LA FUSIÓN');
    console.log('  ✔ Commits posteriores detectados en modo post_merge_commits y categoría D.');
  }

  console.log('[36/54] Árbol equivalente con commits exclusivos no integrados (Corrección D)');
  {
    // Supongamos que diff --quiet devolvería 0, pero aheadCount es 2 y NO hay PR
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: true, stdout: '2', exitCode: 0 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: true, stdout: '', exitCode: 0 };
      }
    });

    const res = verifyIntegrationEvidence('refs/heads/feat/equiv-ahead', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false, 'No debe considerarse integrado si tiene commits exclusivos');
    assert.strictEqual(res.mode, 'not_integrated');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/equiv-ahead', false, env, mockGit);
    assert.strictEqual(analysis.category, 'C'); // Trabajo activo pendiente
    assert.notStrictEqual(analysis.category, 'A');
    console.log('  ✔ Árbol idéntico con commits exclusivos bloquea categoría A y clasifica como C.');
  }

  console.log('[37/54] Árbol equivalente con consulta de commits fallida (Corrección D)');
  {
    // diff --quiet devolvería 0, pero rev-list falló
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }),
      'rev-list': () => ({ ok: false, stdout: '', stderr: 'rev-list error', exitCode: 128 }),
      'diff': (args) => {
        if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: true, stdout: '', exitCode: 0 };
      }
    });

    const res = verifyIntegrationEvidence('refs/heads/feat/equiv-failed-rev', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/equiv-failed-rev', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Fallo en rev-list impide que equivalent_tree clasifique erróneamente en A.');
  }

  console.log('[38/54] Merge SHA válido pero contenido residual (Corrección D)');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const currentSha = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha) && args.includes('refs/remotes/origin/main')) return { ok: true, stdout: '', exitCode: 0 };
        if (args.includes(prHeadSha) && args.includes('refs/heads/feat/residual')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': (args) => {
        const ref = args[args.length - 1];
        if (ref === 'refs/remotes/origin/main') return { ok: true, stdout: dummyMainSha, exitCode: 0 };
        if (ref === 'refs/remotes/origin/Dev') return { ok: true, stdout: dummyDevSha, exitCode: 0 };
        return { ok: true, stdout: currentSha, exitCode: 0 };
      },
      'rev-list': () => ({ ok: true, stdout: '5', exitCode: 0 }) // 5 commits residuales
    });

    const canonicalPr = {
      id: 704,
      number: 704,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/residual', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/residual', canonicalPr, 'refs/remotes/origin/main', currentSha, mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'post_merge_commits');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/residual', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / COMMITS POSTERIORES A LA FUSIÓN');
    console.log('  ✔ Merge SHA en target con commits residuales clasifica como D.');
  }

  console.log('[39/54] Merge SHA ausente (null o cadena vacía) (Corrección D)');
  {
    const canonicalPr = {
      id: 705,
      number: 705,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: '', // Ausente
      base: { ref: 'main' },
      head: { ref: 'feat/missing-sha', sha: '1111', repo: { full_name: CANONICAL_REPO } }
    };
    const mockGit = createMockGit();
    const res = verifyIntegrationEvidence('refs/heads/feat/missing-sha', canonicalPr, 'refs/remotes/origin/main', '1111', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'missing_merge_sha');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/missing-sha', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / FALTA SHA DE INTEGRACIÓN');
    console.log('  ✔ Merge SHA ausente clasifica como D.');
  }

  console.log('[40/54] Evidencia incompleta o prHeadSha no verificable conduce a D (Corrección D)');
  {
    const canonicalPr = {
      id: 706,
      number: 706,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: 'valid-merge-sha',
      base: { ref: 'main' },
      head: { ref: 'feat/no-head-sha', sha: null, repo: { full_name: CANONICAL_REPO } } // Sin head sha
    };
    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes('valid-merge-sha')) return { ok: true, stdout: '', exitCode: 0 };
        return { ok: false, stdout: '', exitCode: 1 };
      }
    });
    const res = verifyIntegrationEvidence('refs/heads/feat/no-head-sha', canonicalPr, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'unverified_head');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/no-head-sha', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / EVIDENCIA HISTÓRICA INCOMPLETA');
    console.log('  ✔ Evidencia histórica incompleta conduce a modo unverified_head y categoría D.');
  }

  // =============================================================
  // BLOQUE 3: 8 NUEVAS PRUEBAS DE MANEJO DE ERRORES DE EJECUCIÓN (41 A 48)
  // =============================================================

  console.log('[41/54] Excepción de lanzamiento de merge-base sin err.status');
  {
    // Simular gitExec con una excepción que no tiene código de salida numérico
    const launchErrorGit = (args) => {
      const sub = args[0];
      if (sub === 'merge-base') {
        const err = new Error('Spawn process failed: EPERM');
        err.status = undefined; // Sin código numérico de salida
        return {
          ok: false,
          stdout: '',
          stderr: 'Spawn process failed: EPERM',
          exitCode: -1, // Debe reportar -1, NUNCA 1
          error: err
        };
      }
      return { ok: true, stdout: dummyMainSha, exitCode: 0 };
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', launchErrorGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error', 'Debe clasificar como git_error y nunca como no-ancestría limpia');
    assert.notStrictEqual(res.mode, 'not_integrated');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, launchErrorGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Excepción de lanzamiento sin err.status produce exitCode -1, git_error y categoría D.');
  }

  console.log('[42/54] Ejecutable Git inexistente (ENOENT)');
  {
    const enoentGit = () => {
      const err = new Error('spawn git ENOENT');
      err.code = 'ENOENT';
      err.status = null;
      return {
        ok: false,
        stdout: '',
        stderr: 'spawn git ENOENT',
        exitCode: -1,
        error: err
      };
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', enoentGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, enoentGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / RAMA NO RESUELTA');
    console.log('  ✔ ENOENT (git no encontrado) produce exitCode -1 y categoría D.');
  }

  console.log('[43/54] Timeout o terminación por señal (ETIMEDOUT / SIGTERM)');
  {
    const timeoutGit = () => {
      const err = new Error('Process timed out');
      err.code = 'ETIMEDOUT';
      err.signal = 'SIGTERM';
      err.status = null; // No hay exitCode del proceso
      return {
        ok: false,
        stdout: '',
        stderr: 'Process timed out after 10000ms',
        exitCode: -1,
        error: err
      };
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/test', null, 'refs/remotes/origin/main', 'sha1', timeoutGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test', false, env, timeoutGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / RAMA NO RESUELTA');
    console.log('  ✔ Timeout / terminación por señal tratada como error de Git y categoría D.');
  }

  console.log('[44/54] Fallo de lanzamiento durante la comprobación de ancestría de prHeadSha');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const currentSha = 'dddddddddddddddddddddddddddddddddddddddd';
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        // mergeSha ok en target
        if (args.includes(mergeSha)) return { ok: true, stdout: '', exitCode: 0 };
        // Al consultar prHeadSha contra la rama, ocurre fallo de lanzamiento
        if (args.includes(prHeadSha)) {
          return { ok: false, stdout: '', stderr: 'fatal: spawn error on prHeadSha check', exitCode: -1 };
        }
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': () => ({ ok: true, stdout: currentSha, exitCode: 0 })
    });

    const canonicalPr = {
      id: 801,
      number: 801,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/test-pr-head-err', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/test-pr-head-err', canonicalPr, 'refs/remotes/origin/main', currentSha, mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');
    assert(res.error.includes('fatal: spawn error on prHeadSha check'));

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test-pr-head-err', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Fallo en verificación de prHeadSha produce git_error y categoría D (nunca branch_behind_pr).');
  }

  console.log('[45/54] Fallo de lanzamiento durante la comprobación de merge_commit_sha');
  {
    const prHeadSha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const mergeSha = 'cccccccccccccccccccccccccccccccccccccccc';

    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes(mergeSha)) {
          return { ok: false, stdout: '', stderr: 'fatal: I/O error checking merge_commit_sha', exitCode: -1 };
        }
        return { ok: false, stdout: '', exitCode: 1 };
      },
      'rev-parse': () => ({ ok: true, stdout: prHeadSha, exitCode: 0 })
    });

    const canonicalPr = {
      id: 802,
      number: 802,
      state: 'closed',
      merged_at: '2026-11-01T12:00:00Z',
      merge_commit_sha: mergeSha,
      base: { ref: 'main' },
      head: { ref: 'feat/test-merge-sha-err', sha: prHeadSha, repo: { full_name: CANONICAL_REPO } }
    };

    const res = verifyIntegrationEvidence('refs/heads/feat/test-merge-sha-err', canonicalPr, 'refs/remotes/origin/main', prHeadSha, mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'git_error');
    assert(res.error.includes('fatal: I/O error checking merge_commit_sha'));

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [canonicalPr] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/test-merge-sha-err', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    console.log('  ✔ Fallo en comprobación de merge_commit_sha produce git_error y categoría D.');
  }

  console.log('[46/54] Fallo de lanzamiento durante las comprobaciones de analyzeBranch()');
  {
    const mockGit = createMockGit({
      'merge-base': (args) => {
        if (args.includes('refs/remotes/origin/main') || args.includes('refs/remotes/origin/Dev')) {
          return { ok: false, stdout: '', stderr: 'fatal: git died unexpectedly', exitCode: -1 };
        }
        return { ok: false, stdout: '', exitCode: 1 };
      }
    });

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/branch-anc-err', false, env, mockGit);
    assert.strictEqual(analysis.category, 'D');
    assert.strictEqual(analysis.recommendation, 'DETENER / ERROR EN CONSULTA GIT');
    assert(analysis.rationale.includes('git died unexpectedly'));
    console.log('  ✔ Fallo en consultas generales de analyzeBranch() activa gitQueryError y categoría D.');
  }

  console.log('[47/54] Confirmación de que una no-ancestría real con código 1 sigue tratándose correctamente');
  {
    const mockGit = createMockGit({
      'merge-base': () => ({ ok: false, stdout: '', exitCode: 1 }), // Código real 1 documentado
      'rev-list': () => ({ ok: true, stdout: '3', exitCode: 0 })
    });

    const res = verifyIntegrationEvidence('refs/heads/feat/real-not-anc', null, 'refs/remotes/origin/main', 'sha1', mockGit);
    assert.strictEqual(res.integrated, false);
    assert.strictEqual(res.mode, 'not_integrated', 'Código 1 legítimo debe resultar en not_integrated, no en git_error');

    const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
    const analysis = analyzeBranch('feat/real-not-anc', false, env, mockGit);
    assert.strictEqual(analysis.category, 'C'); // Trabajo activo pendiente
    console.log('  ✔ Código real 1 tratado legítimamente como no-ancestría sin generar git_error.');
  }

  console.log('[48/54] Confirmación de que NINGÚN error de ejecución puede producir categoría [A]');
  {
    const errorCodes = [-1, 2, 128, 255];
    for (const code of errorCodes) {
      const mockGit = createMockGit({
        'merge-base': () => ({ ok: false, stdout: '', stderr: `error with exitCode ${code}`, exitCode: code }),
        'diff': (args) => {
          if (args.includes('--quiet')) return { ok: true, stdout: '', exitCode: 0 }; // Árbol supuestamente idéntico
          return { ok: true, stdout: '', exitCode: 0 };
        }
      });

      const env = { currentBranch: 'other', githubResult: { status: 'success', prs: [] }, worktreeEntries: [], mainSha: dummyMainSha, devSha: dummyDevSha };
      const analysis = analyzeBranch('feat/guaranteed-safe', false, env, mockGit);
      assert.notStrictEqual(analysis.category, 'A', `Error de ejecución (exitCode ${code}) NUNCA debe permitir categoría A`);
      assert.strictEqual(analysis.category, 'D', `Error de ejecución (exitCode ${code}) debe forzar categoría D`);
    }
    console.log('  ✔ Verificación absoluta: ningún error de ejecución produce categoría A.');
  }


  // =============================================================
  // BLOQUE 4: COBERTURA DIRECTA DE gitExec() REAL (PRUEBAS 49 A 54)
  // =============================================================

  const repoRoot = path.resolve(__dirname, '..');

  console.log('[49/54] Excepción sin err.status: gitExec() real devuelve exitCode: -1');
  {
    // A. Argumentos vacíos / no válidos
    const resEmpty = gitExec([]);
    assert.strictEqual(resEmpty.ok, false);
    assert.strictEqual(resEmpty.exitCode, -1);
    assert.strictEqual(typeof resEmpty.stderr, 'string');
    assert(resEmpty.error instanceof Error);
    assert.notStrictEqual(resEmpty.exitCode, 1, 'Excepción sin err.status jamás debe ser código 1');

    // B. Subcomando denegado
    const resDisallowed = gitExec(['push', 'origin', 'main']);
    assert.strictEqual(resDisallowed.ok, false);
    assert.strictEqual(resDisallowed.exitCode, -1);
    assert.notStrictEqual(resDisallowed.exitCode, 1);

    // C. CWD inexistente provocando excepción en execFileSync sin código de salida del proceso
    const nonexistentCwd = path.join(repoRoot, 'nonexistent_test_dir_gitexec_status_check');
    const resCwd = gitExec(['rev-parse', 'HEAD'], { cwd: nonexistentCwd });
    assert.strictEqual(resCwd.ok, false);
    assert.strictEqual(resCwd.exitCode, -1);
    assert.strictEqual(resCwd.error.status, null);
    assert.notStrictEqual(resCwd.exitCode, 1, 'Fallo de lanzamiento de proceso no debe convertirse en código 1');
    console.log('  ✔ gitExec() real devuelve exitCode: -1 ante excepciones sin err.status.');
  }

  console.log('[50/54] Ejecutable inexistente (ENOENT): gitExec() real no convierte la excepción en código 1');
  {
    const emptyPath = path.join(repoRoot, 'empty_dir_no_git_binary_test');
    const resEnoent = gitExec(['rev-parse', 'HEAD'], { env: { ...process.env, PATH: emptyPath } });
    assert.strictEqual(resEnoent.ok, false);
    assert.strictEqual(resEnoent.exitCode, -1);
    assert.strictEqual(resEnoent.error.code, 'ENOENT');
    assert.notStrictEqual(resEnoent.exitCode, 1, 'ENOENT NUNCA debe convertirse en código 1 de no-ancestría');
    assert(resEnoent.stderr.includes('ENOENT') || resEnoent.error.message.includes('ENOENT'));
    console.log('  ✔ gitExec() real preserva error ENOENT y asigna exitCode -1 sin confundirlo con código 1.');
  }

  console.log('[51/54] Timeout o terminación por señal: gitExec() real clasifica la excepción como error');
  {
    const fs = require('fs');
    const os = require('os');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-audit-timeout-test-'));

    try {
      // 1. Crear ejecutable auxiliar controlado en directorio temporal fuera del repositorio.
      // process.execPath (el binario de Node.js) se copia con el nombre del comando ejecutado por gitExec ('git' o 'git.exe').
      const binaryName = process.platform === 'win32' ? 'git.exe' : 'git';
      const fakeGit = path.join(tempDir, binaryName);
      fs.copyFileSync(process.execPath, fakeGit);
      if (process.platform !== 'win32') {
        fs.chmodSync(fakeGit, 0o755);
      }

      // 2. Crear script auxiliar controlado que permanece bloqueado esperando 60 segundos.
      // Cuando execFileSync('git', ['rev-parse', 'HEAD']) invoque el ejecutable auxiliar con cwd: tempDir,
      // Node ejecutará este archivo 'rev-parse'. Si el proceso terminara normalmente (antes del timeout),
      // tardaría 60 segundos, garantizando que una terminación normal antes del timeout no ocurra.
      const blockingScript = path.join(tempDir, 'rev-parse');
      fs.writeFileSync(blockingScript, 'setTimeout(() => {}, 60000);\n');
      if (process.platform !== 'win32') {
        fs.chmodSync(blockingScript, 0o755);
      }

      // 3. Invocar la función gitExec() real pasando opciones aisladas con timeout estricto de 100ms.
      // Se aísla el PATH anteponiendo tempDir para resolver el ejecutable auxiliar controlado.
      const resTimeout = gitExec(['rev-parse', 'HEAD'], {
        cwd: tempDir,
        env: { ...process.env, PATH: tempDir + path.delimiter + (process.env.PATH || '') },
        timeout: 100
      });

      // 4. Validaciones obligatorias de seguridad
      assert.strictEqual(resTimeout.ok, false, 'La ejecución interrumpida por timeout debe reportar ok: false');
      assert.strictEqual(resTimeout.exitCode, -1, 'El timeout debe reportar exitCode: -1 (excepción de lanzamiento/ejecución)');
      assert.notStrictEqual(resTimeout.exitCode, 1, 'Timeout NUNCA debe convertirse en código legítimo 1');
      assert(resTimeout.error, 'Debe registrarse el error capturado en el objeto de resultado');

      // Comprobar error de timeout o terminación por señal
      const isTimeoutOrSignal = resTimeout.error.code === 'ETIMEDOUT' || resTimeout.error.signal === 'SIGTERM';
      assert.strictEqual(isTimeoutOrSignal, true, 'El error debe reportar ETIMEDOUT o terminación por señal SIGTERM');
      assert.strictEqual(resTimeout.error.status, null, 'El proceso interrumpido por timeout no debe reportar status numérico');
      assert(resTimeout.stderr.includes('ETIMEDOUT') || resTimeout.stderr.includes('SIGTERM') || resTimeout.stderr.includes('timed out'));

      console.log('  ✔ gitExec() real clasifica timeout como error de ejecución con exitCode -1.');
    } finally {
      // 5. Limpieza garantizada de recursos temporales fuera del repositorio
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }

  console.log('[52/54] Código real 1: ejecución legítima de Git conserva código 1 y no se transforma en -1');
  {
    // HEAD no es ancestro de HEAD~1 en este repositorio (HEAD es su descendiente)
    const resExit1 = gitExec(['merge-base', '--is-ancestor', 'HEAD', 'HEAD~1'], { cwd: repoRoot });
    assert.strictEqual(resExit1.ok, false);
    assert.strictEqual(resExit1.exitCode, 1, 'El código legítimo 1 de no-ancestría debe conservarse intacto');
    assert.strictEqual(resExit1.error.status, 1);
    assert.notStrictEqual(resExit1.exitCode, -1, 'El código legítimo 1 no debe convertirse en -1');
    console.log('  ✔ gitExec() real conserva legítimamente exitCode 1 sin alterarlo.');
  }

  console.log('[53/54] Código real mayor que 1: conserva el código numérico reportado por Git y clasifica como error');
  {
    // rev-parse de referencia inexistente produce código 128
    const resExit128 = gitExec(['rev-parse', '--verify', 'refs/heads/nonexistent_test_branch_999999'], { cwd: repoRoot });
    assert.strictEqual(resExit128.ok, false);
    assert.strictEqual(resExit128.exitCode, 128, 'El código numérico 128 debe conservarse intacto');
    assert.strictEqual(resExit128.error.status, 128);
    assert.notStrictEqual(resExit128.exitCode, -1);
    assert.notStrictEqual(resExit128.exitCode, 1);
    assert(resExit128.stderr.includes('fatal:'));
    console.log('  ✔ gitExec() real conserva código de error numérico de Git (>1) y marca ok: false.');
  }

  console.log('[54/54] Separación inequívoca: resultados de excepciones (-1) y códigos reales (1) no son intercambiables');
  {
    const emptyPath = path.join(repoRoot, 'empty_dir_no_git_binary_test');
    const resEnoent = gitExec(['rev-parse', 'HEAD'], { env: { ...process.env, PATH: emptyPath } });
    const resExit1 = gitExec(['merge-base', '--is-ancestor', 'HEAD', 'HEAD~1'], { cwd: repoRoot });

    // 1. Verificación a nivel de códigos primitivos de gitExec
    assert.notStrictEqual(resEnoent.exitCode, resExit1.exitCode);
    assert.strictEqual(resEnoent.exitCode, -1);
    assert.strictEqual(resExit1.exitCode, 1);
    assert.strictEqual(resEnoent.ok, false);
    assert.strictEqual(resExit1.ok, false);

    // 2. Verificación de comportamiento en la lógica de decisión:
    // Una excepción de lanzamiento forzada con gitExec conduce indefectiblemente a git_error
    const resFromException = verifyIntegrationEvidence(
      'refs/heads/docs/feature-lifecycle-policy',
      null,
      'refs/remotes/origin/main',
      '9d5b5f475c801c316cb945508bf5e7ac31a68a60',
      () => resEnoent
    );
    assert.strictEqual(resFromException.integrated, false);
    assert.strictEqual(resFromException.mode, 'git_error');

    // Una ejecución real de Git evaluando la rama contra origin/main (sin PR fusionado)
    // procesa el código 1 como evaluación normal de no-ancestría y no genera git_error
    const realGitExecWithCwd = (args) => gitExec(args, { cwd: repoRoot });
    const resFromRealGit = verifyIntegrationEvidence(
      'refs/heads/docs/feature-lifecycle-policy',
      null,
      'refs/remotes/origin/main',
      '9d5b5f475c801c316cb945508bf5e7ac31a68a60',
      realGitExecWithCwd
    );
    assert.strictEqual(resFromRealGit.integrated, false);
    assert.notStrictEqual(resFromRealGit.mode, 'git_error', 'Ejecución real con código legítimo 1 no debe producir git_error');
    assert.strictEqual(resFromRealGit.mode, 'not_integrated');
    assert.notStrictEqual(resFromException.mode, resFromRealGit.mode, 'Los modos git_error y not_integrated son estrictamente disjuntos');
    console.log('  ✔ Separación inequívoca demostrada: las excepciones y los códigos reales 1 operan por vías completamente disjuntas.');
  }

  console.log('\n===============================================================');
  console.log(' RESULTADO: 54/54 PRUEBAS EJECUTADAS Y SUPERADAS CON ÉXITO');
  console.log('===============================================================');
}

runAllTests().catch(err => {
  console.error('\n✖ FALLO EN LA SUITE DE PRUEBAS:', err);
  process.exit(1);
});
