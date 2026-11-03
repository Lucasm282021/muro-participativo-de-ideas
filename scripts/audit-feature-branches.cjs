#!/usr/bin/env node
/**
 * scripts/audit-feature-branches.cjs
 * Herramienta de auditoría e inventario para el ciclo de vida de ramas feat/*.
 * ESTRICTAMENTE INFORMATIVA - NO EJECUTA OPERACIONES DESTRUCTIVAS NI MODIFICACIONES.
 */

const { execFileSync } = require('child_process');

/**
 * Ejecuta un comando de Git de forma segura utilizando execFileSync con argumentos separados.
 * Previene cualquier inyección de comandos o interpretación por shell.
 */
function gitSafe(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Extrae credenciales de GitHub de forma segura mediante git credential fill.
 */
function getGitHubToken() {
  try {
    const creds = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const match = creds.match(/password=(.+)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    return process.env.GITHUB_TOKEN || null;
  }
}

/**
 * Consulta la API de GitHub distinguiendo explícitamente:
 * - Éxito con o sin PRs.
 * - Error de autenticación (401/403).
 * - Error de servidor o conexión (5xx / network).
 */
async function fetchPRs(token) {
  if (!token) {
    return {
      status: 'no_token',
      prs: [],
      message: 'No se detectó token de autenticación (git credential / GITHUB_TOKEN)'
    };
  }

  try {
    const res = await fetch('https://api.github.com/repos/Lucasm282021/muro-participativo-de-ideas/pulls?state=all&per_page=100', {
      headers: {
        'Authorization': 'token ' + token,
        'User-Agent': 'Node-Audit-Script'
      }
    });

    if (res.status === 401 || res.status === 403) {
      return {
        status: 'auth_error',
        httpStatus: res.status,
        prs: [],
        message: `Error de autenticación con GitHub API (HTTP ${res.status})`
      };
    }

    if (!res.ok) {
      return {
        status: 'http_error',
        httpStatus: res.status,
        prs: [],
        message: `Error en respuesta de GitHub API (HTTP ${res.status})`
      };
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      return {
        status: 'invalid_response',
        prs: [],
        message: 'Respuesta de GitHub API no es un arreglo válido'
      };
    }

    return {
      status: 'success',
      prs: data,
      message: `Consulta exitosa (${data.length} PRs recuperados)`
    };
  } catch (err) {
    return {
      status: 'network_error',
      prs: [],
      message: `Fallo de conexión de red al consultar GitHub API: ${err.message}`
    };
  }
}

async function main() {
  console.log('===============================================================');
  console.log(' AUDITORÍA DE CICLO DE VIDA DE RAMAS FEATURE (feat/*)');
  console.log(' Repositorio: Lucasm282021/muro-participativo-de-ideas');
  console.log(' Modo: Estrictamente Informativo (Solo Lectura)');
  console.log('===============================================================\n');

  const mainSha = gitSafe(['rev-parse', 'origin/main']) || gitSafe(['rev-parse', 'main']);
  const devSha = gitSafe(['rev-parse', 'origin/Dev']) || gitSafe(['rev-parse', 'Dev']);

  console.log('Punteros canónicos:');
  console.log(`  origin/main: ${mainSha || 'No encontrado'}`);
  console.log(`  origin/Dev:  ${devSha || 'No encontrado'}\n`);

  // Obtener worktrees activos de forma segura
  const worktreeRaw = gitSafe(['worktree', 'list', '--porcelain']) || '';
  const worktreeEntries = [];
  let currentWt = {};
  for (const line of worktreeRaw.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (currentWt.path) worktreeEntries.push(currentWt);
      currentWt = { path: line.replace('worktree ', '').trim() };
    } else if (line.startsWith('HEAD ')) {
      currentWt.head = line.replace('HEAD ', '').trim();
    } else if (line.startsWith('branch ')) {
      currentWt.branch = line.replace('branch refs/heads/', '').trim();
    }
  }
  if (currentWt.path) worktreeEntries.push(currentWt);

  // Consultar estado de GitHub API
  const token = getGitHubToken();
  const githubResult = await fetchPRs(token);
  console.log(`Estado de GitHub API: [${githubResult.status}] ${githubResult.message}\n`);

  // Listar ramas locales y remotas
  const branchRaw = gitSafe(['branch', '-a']) || '';
  const lines = branchRaw.split('\n').map(l => l.replace(/^[*+ ]+/, '').trim()).filter(Boolean);

  const localFeats = lines.filter(b => b.startsWith('feat/'));
  const remoteFeats = lines.filter(b => b.startsWith('remotes/origin/feat/')).map(b => b.replace('remotes/origin/', ''));

  console.log(`Ramas locales detectadas: ${localFeats.length}`);
  console.log(`Ramas remotas detectadas: ${remoteFeats.length}\n`);

  const currentBranch = gitSafe(['branch', '--show-current']);

  function analyzeBranch(branchName, isRemote = false) {
    const fullRef = isRemote ? `origin/${branchName}` : branchName;
    const sha = gitSafe(['rev-parse', fullRef]);
    if (!sha) return null;

    // Buscar PR asociado si la consulta fue exitosa
    let associatedPrText = 'No consultable';
    let prFound = null;

    if (githubResult.status === 'success') {
      prFound = githubResult.prs.find(p => p.head && p.head.ref === branchName);
      if (prFound) {
        associatedPrText = `#${prFound.number} (${prFound.state}${prFound.merged_at ? ', merged' : ''})`;
      } else {
        associatedPrText = 'Ninguno (confirmado en GitHub)';
      }
    } else {
      associatedPrText = `No disponible (${githubResult.message})`;
    }

    // Contención por ancestría directa (ejecución segura sin shell)
    const inMainAncestry = gitSafe(['merge-base', '--is-ancestor', fullRef, 'origin/main']) !== null;
    const inDevAncestry = gitSafe(['merge-base', '--is-ancestor', fullRef, 'origin/Dev']) !== null;

    // Commits exclusivos respecto a main y Dev
    const aheadMainStr = gitSafe(['rev-list', '--count', `origin/main..${fullRef}`]) || '0';
    const aheadDevStr = gitSafe(['rev-list', '--count', `origin/Dev..${fullRef}`]) || '0';
    const aheadMain = parseInt(aheadMainStr, 10);
    const aheadDev = parseInt(aheadDevStr, 10);

    // Diferencias de contenido contra origin/main
    const diffStat = gitSafe(['diff', fullRef, 'origin/main', '--stat']) || '';
    const diffLines = diffStat.split('\n').filter(Boolean);
    const diffSummary = diffLines.length > 0 ? diffLines[diffLines.length - 1].trim() : 'Sin diferencias de archivos';

    // Worktree asociado
    const wt = worktreeEntries.find(w => w.branch === branchName || (isRemote && w.head === sha));

    // Determinar categoría y recomendación con salvaguardas
    let category = 'D';
    let recommendation = 'Requiere análisis manual';
    let rationale = '';

    if (!isRemote && branchName === currentBranch) {
      category = 'C';
      recommendation = 'CONSERVAR';
      rationale = 'Rama activa en la sesión de trabajo (protegida).';
    } else if (prFound && prFound.merged_at) {
      category = 'A';
      recommendation = 'APTA PARA ELIMINACIÓN';
      rationale = `PR #${prFound.number} fusionado en ${prFound.base.ref} el ${prFound.merged_at}.`;
    } else if (inMainAncestry || inDevAncestry) {
      category = 'A';
      recommendation = 'APTA PARA ELIMINACIÓN';
      rationale = `Contenida por ancestría directa en ${inMainAncestry ? 'main' : 'Dev'}.`;
    } else if (prFound && prFound.state === 'closed' && !prFound.merged_at) {
      category = 'B';
      recommendation = 'EVALUAR / VERIFICAR SI FUE INTEGRADA POR PROMO';
      rationale = `PR #${prFound.number} cerrado sin merge.`;
    } else if (githubResult.status !== 'success') {
      // Salvaguarda: si falló la consulta a GitHub, NO clasificar como eliminable a ramas no integradas por ancestría
      category = 'D';
      recommendation = 'DETENER / CONSULTA GITHUB PENDIENTE';
      rationale = `No se pudo verificar estado de PR en GitHub (${githubResult.message}).`;
    } else if (aheadMain > 0 && aheadDev > 0) {
      category = 'C';
      recommendation = 'CONSERVAR (TRABAJO ACTIVO O PENDIENTE)';
      rationale = `Contiene commits no integrados (${aheadMain} vs main, ${aheadDev} vs Dev) y no tiene PR fusionado.`;
    }

    return {
      branchName,
      isRemote,
      sha,
      associatedPr: associatedPrText,
      inMainAncestry,
      inDevAncestry,
      aheadMain,
      aheadDev,
      diffSummary,
      worktree: wt ? wt.path : 'Ninguno',
      category,
      recommendation,
      rationale
    };
  }

  console.log('--- REPORTE DE RAMAS LOCALES (feat/*) ---');
  for (const b of localFeats) {
    const info = analyzeBranch(b, false);
    if (!info) continue;
    console.log(`\n• Rama: ${info.branchName} [${info.sha.substring(0, 7)}]`);
    console.log(`  Categoría:      [${info.category}] -> ${info.recommendation}`);
    console.log(`  PR Asociado:    ${info.associatedPr}`);
    console.log(`  Ancestría:      main: ${info.inMainAncestry} | Dev: ${info.inDevAncestry}`);
    console.log(`  Commits no en:  main: ${info.aheadMain} | Dev: ${info.aheadDev}`);
    console.log(`  Diff vs main:   ${info.diffSummary}`);
    console.log(`  Worktree:       ${info.worktree}`);
    console.log(`  Motivo:         ${info.rationale}`);
  }

  console.log('\n--- REPORTE DE RAMAS REMOTAS (origin/feat/*) ---');
  for (const b of remoteFeats) {
    const info = analyzeBranch(b, true);
    if (!info) continue;
    console.log(`\n• Rama Remota: origin/${info.branchName} [${info.sha.substring(0, 7)}]`);
    console.log(`  Categoría:      [${info.category}] -> ${info.recommendation}`);
    console.log(`  PR Asociado:    ${info.associatedPr}`);
    console.log(`  Ancestría:      main: ${info.inMainAncestry} | Dev: ${info.inDevAncestry}`);
    console.log(`  Commits no en:  main: ${info.aheadMain} | Dev: ${info.aheadDev}`);
    console.log(`  Diff vs main:   ${info.diffSummary}`);
    console.log(`  Motivo:         ${info.rationale}`);
  }

  console.log('\n===============================================================');
  console.log(' FIN DE AUDITORÍA');
  console.log('===============================================================');
}

main().catch(err => {
  console.error('Error fatal en ejecución de auditoría:', err);
  process.exit(1);
});
