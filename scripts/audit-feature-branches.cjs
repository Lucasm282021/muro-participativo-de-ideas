#!/usr/bin/env node
/**
 * scripts/audit-feature-branches.cjs
 * Herramienta de auditoría e inventario para el ciclo de vida de ramas feat/*.
 * ESTRICTAMENTE INFORMATIVA - MODO SOLO LECTURA.
 *
 * GARANTÍAS DE SEGURIDAD Y CONTROL DE RIESGOS:
 * 1. Riesgos evitados:
 *    - Inyección de comandos de shell: los procesos se invocan directamente con execFileSync
 *      pasando argumentos separados en arrays, sin invocar intérpretes (/bin/sh, cmd.exe, powershell).
 *    - Desambiguación de referencias: se utilizan referencias canónicas completas (refs/heads/*,
 *      refs/remotes/origin/*) para evitar ambigüedades con tags, archivos o banderas de comandos.
 *    - Operaciones destructivas: lista blanca estricta de subcomandos Git de solo lectura.
 *    - Falsos positivos por fallos de red o autenticación: ante respuestas incompletas o errores,
 *      se emite un dictamen conservador [D] (Detener / Revisión manual) y nunca se recomienda eliminar.
 *    - Falsos positivos por destinos inválidos: solo se consideran integraciones efectivas
 *      aquellas con merged_at != null y destino canónico ('main' o 'Dev').
 *    - Omisión de PRs antiguos: paginación completa y exhaustiva de la API de GitHub.
 *
 * 2. Riesgos que requieren validación manual:
 *    - Cambios locales no commiteados en otros clones o estaciones remotas de trabajo.
 *    - Sobrescrituras forzadas previas en ramas remotas que pudieran alterar el grafo histórico.
 *    - Integraciones de contenido parcial o refactorizaciones complejas que no compartan grafo ni diff directo.
 */

const { execFileSync } = require('child_process');

// Lista blanca estricta de subcomandos de Git permitidos (solo lectura)
const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'rev-parse', 'worktree', 'branch', 'merge-base', 'rev-list', 'diff', 'credential', 'show'
]);

// Destinos canónicos autorizados para considerar una feature como formalmente integrada
const CANONICAL_TARGETS = new Set(['main', 'Dev']);

/**
 * Ejecuta un comando de Git de forma segura y devuelve un objeto de resultado detallado.
 * No oculta errores ni convierte fallos en valores nulos indiscriminadamente.
 */
function gitExec(args, options = {}) {
  if (!Array.isArray(args) || args.length === 0) {
    return {
      ok: false,
      stdout: '',
      stderr: 'Argumentos de Git no proporcionados',
      exitCode: -1,
      error: new Error('Empty arguments array')
    };
  }

  const subcommand = args[0];
  if (!ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
    return {
      ok: false,
      stdout: '',
      stderr: `Subcomando de Git denegado por política de solo lectura: ${subcommand}`,
      exitCode: -1,
      error: new Error(`Disallowed Git subcommand: ${subcommand}`)
    };
  }

  try {
    const stdout = execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      ...options
    });
    return {
      ok: true,
      stdout: stdout.trim(),
      stderr: '',
      exitCode: 0,
      error: null
    };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout ? err.stdout.toString() : '').trim(),
      stderr: (err.stderr ? err.stderr.toString() : '').trim(),
      exitCode: typeof err.status === 'number' ? err.status : 1,
      error: err
    };
  }
}

/**
 * Extrae credenciales de GitHub de forma segura mediante git credential fill.
 */
function getGitHubToken() {
  const res = gitExec(['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n'
  });
  if (res.ok && res.stdout) {
    const match = res.stdout.match(/password=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.GITHUB_TOKEN || null;
}

/**
 * Consulta exhaustiva y paginada de Pull Requests en la API de GitHub.
 * Recorre todas las páginas necesarias, detecta duplicados y gestiona errores por página.
 */
async function fetchAllPRs(token, maxPages = 50) {
  if (!token) {
    return {
      status: 'no_token',
      prs: [],
      pagesFetched: 0,
      message: 'No se detectó token de autenticación (git credential / GITHUB_TOKEN)'
    };
  }

  const allPrs = [];
  const seenIds = new Set();
  let page = 1;

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/Lucasm282021/muro-participativo-de-ideas/pulls?state=all&per_page=100&page=${page}`;
    let res;
    try {
      res = await fetch(url, {
        headers: {
          'Authorization': 'token ' + token,
          'User-Agent': 'Node-Audit-Script',
          'Accept': 'application/vnd.github.v3+json'
        }
      });
    } catch (err) {
      if (page === 1) {
        return {
          status: 'network_error',
          prs: [],
          pagesFetched: 0,
          message: `Fallo de conexión de red al consultar GitHub API: ${err.message}`
        };
      } else {
        return {
          status: 'pagination_error',
          prs: allPrs,
          pagesFetched: page - 1,
          message: `Consulta incompleta por error de red en página ${page} tras recuperar ${allPrs.length} PRs: ${err.message}`
        };
      }
    }

    if (res.status === 401 || res.status === 403) {
      return {
        status: 'auth_error',
        httpStatus: res.status,
        prs: allPrs,
        pagesFetched: page - 1,
        message: `Error de autenticación con GitHub API (HTTP ${res.status}) en página ${page}`
      };
    }

    if (!res.ok) {
      if (page === 1) {
        return {
          status: 'http_error',
          httpStatus: res.status,
          prs: [],
          pagesFetched: 0,
          message: `Error en respuesta de GitHub API (HTTP ${res.status})`
        };
      } else {
        return {
          status: 'pagination_error',
          httpStatus: res.status,
          prs: allPrs,
          pagesFetched: page - 1,
          message: `Consulta incompleta por error HTTP ${res.status} en página ${page} tras recuperar ${allPrs.length} PRs`
        };
      }
    }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      return {
        status: page === 1 ? 'invalid_response' : 'pagination_error',
        prs: allPrs,
        pagesFetched: page - 1,
        message: `Respuesta inválida (JSON no parseable) en página ${page}`
      };
    }

    if (!Array.isArray(data)) {
      return {
        status: page === 1 ? 'invalid_response' : 'pagination_error',
        prs: allPrs,
        pagesFetched: page - 1,
        message: `Respuesta de GitHub API no es un arreglo en página ${page}`
      };
    }

    // Fin de la colección
    if (data.length === 0) {
      break;
    }

    for (const pr of data) {
      if (pr && pr.id && !seenIds.has(pr.id)) {
        seenIds.add(pr.id);
        allPrs.push(pr);
      }
    }

    // Menos de 100 registros indica última página
    if (data.length < 100) {
      break;
    }

    page++;
  }

  return {
    status: 'success',
    prs: allPrs,
    pagesFetched: page,
    message: allPrs.length > 0
      ? `Consulta completa (${allPrs.length} PRs recuperados en ${page} página${page > 1 ? 's' : ''})`
      : 'Consulta completa sin resultados (0 PRs)'
  };
}

/**
 * Función central de análisis y clasificación para una rama individual.
 */
function analyzeBranch(branchName, isRemote, env) {
  const { currentBranch, githubResult, worktreeEntries, mainSha, devSha } = env;

  // Validación preventiva del formato de nombre de rama
  if (/[\s~^:?*\[\\]/.test(branchName)) {
    return {
      branchName,
      isRemote,
      sha: 'inválido',
      associatedPr: 'No consultado',
      inMainAncestry: false,
      inDevAncestry: false,
      aheadMain: null,
      aheadDev: null,
      diffSummary: 'Nombre de rama con caracteres inválidos',
      worktree: 'Ninguno',
      category: 'D',
      recommendation: 'DETENER / NOMBRE DE RAMA INVÁLIDO',
      rationale: 'El nombre de la rama contiene caracteres especiales o inválidos para Git.'
    };
  }

  // 1. Resolver SHA de la rama usando referencia canónica desambiguada
  const fullRef = isRemote ? `refs/remotes/origin/${branchName}` : `refs/heads/${branchName}`;
  const shaRes = gitExec(['rev-parse', '--verify', fullRef]);
  if (!shaRes.ok || !shaRes.stdout) {
    return {
      branchName,
      isRemote,
      sha: 'no encontrada',
      associatedPr: 'No consultado',
      inMainAncestry: false,
      inDevAncestry: false,
      aheadMain: null,
      aheadDev: null,
      diffSummary: 'Rama no existe o no pudo ser resuelta',
      worktree: 'Ninguno',
      category: 'D',
      recommendation: 'DETENER / RAMA NO RESUELTA',
      rationale: `Error al resolver referencia en Git (${fullRef}): ${shaRes.stderr || 'No encontrada'}`
    };
  }
  const sha = shaRes.stdout;

  // 2. Asociar PRs y comprobar destino real de integración (Corrección A)
  let associatedPrText = 'No consultable';
  let matchingPrs = [];
  let canonicalMergedPr = null;
  let nonCanonicalMergedPr = null;
  let openPr = null;
  let closedUnmergedPr = null;

  if (githubResult.status === 'success') {
    matchingPrs = githubResult.prs.filter(p => p.head && p.head.ref === branchName);
    if (matchingPrs.length > 0) {
      associatedPrText = matchingPrs.map(p => {
        const mergeState = p.merged_at ? `merged->${p.base.ref}` : p.state;
        return `#${p.number} (${mergeState})`;
      }).join(', ');

      canonicalMergedPr = matchingPrs.find(p => p.merged_at && CANONICAL_TARGETS.has(p.base.ref));
      nonCanonicalMergedPr = matchingPrs.find(p => p.merged_at && !CANONICAL_TARGETS.has(p.base.ref));
      openPr = matchingPrs.find(p => p.state === 'open');
      closedUnmergedPr = matchingPrs.find(p => p.state === 'closed' && !p.merged_at);
    } else {
      associatedPrText = 'Ninguno (confirmado en GitHub)';
    }
  } else {
    associatedPrText = `No disponible (${githubResult.message})`;
  }

  // 3. Comprobar contención en Git con tratamiento explícito de errores (Corrección C)
  let gitQueryError = null;
  const canonicalMainRef = 'refs/remotes/origin/main';
  const canonicalDevRef = 'refs/remotes/origin/Dev';

  // 3a. Ancestría en origin/main
  let inMainAncestry = false;
  if (mainSha) {
    const mainAncRes = gitExec(['merge-base', '--is-ancestor', fullRef, canonicalMainRef]);
    if (mainAncRes.exitCode === 0) {
      inMainAncestry = true;
    } else if (mainAncRes.exitCode === 1) {
      inMainAncestry = false;
    } else {
      gitQueryError = `Fallo en merge-base ${canonicalMainRef}: ${mainAncRes.stderr || mainAncRes.error?.message}`;
    }
  }

  // 3b. Ancestría en origin/Dev
  let inDevAncestry = false;
  if (devSha && !gitQueryError) {
    const devAncRes = gitExec(['merge-base', '--is-ancestor', fullRef, canonicalDevRef]);
    if (devAncRes.exitCode === 0) {
      inDevAncestry = true;
    } else if (devAncRes.exitCode === 1) {
      inDevAncestry = false;
    } else {
      gitQueryError = `Fallo en merge-base ${canonicalDevRef}: ${devAncRes.stderr || devAncRes.error?.message}`;
    }
  }

  // 3c. Commits exclusivos
  let aheadMain = 0;
  let aheadDev = 0;
  if (mainSha && !gitQueryError) {
    const aheadMainRes = gitExec(['rev-list', '--count', `${canonicalMainRef}..${fullRef}`]);
    if (aheadMainRes.ok) {
      aheadMain = parseInt(aheadMainRes.stdout, 10);
    } else {
      gitQueryError = `Fallo en rev-list ${canonicalMainRef}: ${aheadMainRes.stderr}`;
    }
  }

  if (devSha && !gitQueryError) {
    const aheadDevRes = gitExec(['rev-list', '--count', `${canonicalDevRef}..${fullRef}`]);
    if (aheadDevRes.ok) {
      aheadDev = parseInt(aheadDevRes.stdout, 10);
    } else {
      gitQueryError = `Fallo en rev-list ${canonicalDevRef}: ${aheadDevRes.stderr}`;
    }
  }

  // 3d. Diferencias de contenido contra origin/main
  let diffSummary = 'Sin diferencias de archivos';
  if (mainSha && !gitQueryError) {
    const diffRes = gitExec(['diff', '--stat', fullRef, canonicalMainRef]);
    if (diffRes.ok) {
      const diffLines = diffRes.stdout.split('\n').filter(Boolean);
      diffSummary = diffLines.length > 0 ? diffLines[diffLines.length - 1].trim() : 'Sin diferencias de archivos';
    } else {
      gitQueryError = `Fallo en diff ${canonicalMainRef}: ${diffRes.stderr}`;
      diffSummary = 'Error al calcular diferencias';
    }
  }

  // 4. Worktree asociado
  const wt = worktreeEntries.find(w => w.branch === branchName || (isRemote && w.head === sha));

  // 5. Clasificación segura con política conservadora
  let category = 'D';
  let recommendation = 'Requiere análisis manual';
  let rationale = '';

  if (gitQueryError) {
    category = 'D';
    recommendation = 'DETENER / ERROR EN CONSULTA GIT';
    rationale = `Se produjo un error de ejecución en Git: ${gitQueryError}. No se emite recomendación de eliminación.`;
  } else if (!isRemote && branchName === currentBranch) {
    category = 'C';
    recommendation = 'CONSERVAR';
    rationale = 'Rama activa en la sesión actual de trabajo (protegida).';
  } else if (openPr) {
    category = 'C';
    recommendation = 'CONSERVAR (PR ABIERTO)';
    rationale = `PR #${openPr.number} abierto hacia [${openPr.base.ref}]. Trabajo en curso o revisión.`;
  } else if (canonicalMergedPr) {
    category = 'A';
    recommendation = 'APTA PARA ELIMINACIÓN';
    rationale = `PR #${canonicalMergedPr.number} fusionado exitosamente hacia destino canónico [${canonicalMergedPr.base.ref}] el ${canonicalMergedPr.merged_at}.`;
  } else if (nonCanonicalMergedPr) {
    category = 'D';
    recommendation = 'DETENER / DESTINO NO CANÓNICO';
    rationale = `PR #${nonCanonicalMergedPr.number} fue fusionado hacia [${nonCanonicalMergedPr.base.ref}] (destino no canónico). Requiere verificar integración posterior hacia main o Dev.`;
  } else if (inMainAncestry || inDevAncestry) {
    category = 'A';
    recommendation = 'APTA PARA ELIMINACIÓN';
    rationale = `Contenida por ancestría directa comprobada en [${inMainAncestry ? 'main' : 'Dev'}].`;
  } else if (closedUnmergedPr) {
    category = 'B';
    recommendation = 'EVALUAR / VERIFICAR SI FUE INTEGRADA POR PROMO';
    rationale = `PR #${closedUnmergedPr.number} cerrado sin merge hacia [${closedUnmergedPr.base.ref}].`;
  } else if (githubResult.status !== 'success') {
    category = 'D';
    recommendation = 'DETENER / CONSULTA GITHUB PENDIENTE O INCOMPLETA';
    rationale = `No se pudo verificar fehacientemente el estado de PR en GitHub (${githubResult.message}).`;
  } else if (aheadMain > 0 && aheadDev > 0) {
    category = 'C';
    recommendation = 'CONSERVAR (TRABAJO ACTIVO O PENDIENTE)';
    rationale = `Contiene commits no integrados (${aheadMain} vs main, ${aheadDev} vs Dev) y no tiene PR fusionado hacia destino canónico.`;
  } else {
    category = 'D';
    recommendation = 'DETENER / ESTADO INDETERMINADO';
    rationale = 'Evidencia insuficiente para determinar integración; requiere revisión manual.';
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

async function main() {
  console.log('===============================================================');
  console.log(' AUDITORÍA DE CICLO DE VIDA DE RAMAS FEATURE (feat/*)');
  console.log(' Repositorio: Lucasm282021/muro-participativo-de-ideas');
  console.log(' Modo: Estrictamente Informativo (Solo Lectura)');
  console.log('===============================================================\n');

  const mainShaRes = gitExec(['rev-parse', '--verify', 'refs/remotes/origin/main']);
  const devShaRes = gitExec(['rev-parse', '--verify', 'refs/remotes/origin/Dev']);

  const mainSha = mainShaRes.ok ? mainShaRes.stdout : null;
  const devSha = devShaRes.ok ? devShaRes.stdout : null;

  console.log('Punteros canónicos:');
  console.log(`  origin/main: ${mainSha || 'No encontrado (' + mainShaRes.stderr + ')'}`);
  console.log(`  origin/Dev:  ${devSha || 'No encontrado (' + devShaRes.stderr + ')'}\n`);

  // Obtener worktrees activos
  const worktreeRes = gitExec(['worktree', 'list', '--porcelain']);
  const worktreeEntries = [];
  if (worktreeRes.ok && worktreeRes.stdout) {
    let currentWt = {};
    for (const line of worktreeRes.stdout.split('\n')) {
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
  } else {
    console.warn(`Aviso: No se pudo consultar worktrees: ${worktreeRes.stderr}`);
  }

  // Consultar estado de GitHub API con paginación completa (Corrección B)
  const token = getGitHubToken();
  const githubResult = await fetchAllPRs(token);
  console.log(`Estado de GitHub API: [${githubResult.status}] ${githubResult.message}\n`);

  // Listar ramas locales y remotas
  const branchRes = gitExec(['branch', '-a']);
  const lines = branchRes.ok ? branchRes.stdout.split('\n').map(l => l.replace(/^[*+ ]+/, '').trim()).filter(Boolean) : [];

  const localFeats = lines.filter(b => b.startsWith('feat/'));
  const remoteFeats = lines.filter(b => b.startsWith('remotes/origin/feat/')).map(b => b.replace('remotes/origin/', ''));

  console.log(`Ramas locales detectadas: ${localFeats.length}`);
  console.log(`Ramas remotas detectadas: ${remoteFeats.length}\n`);

  const currentBranchRes = gitExec(['branch', '--show-current']);
  const currentBranch = currentBranchRes.ok ? currentBranchRes.stdout : null;

  const env = {
    currentBranch,
    githubResult,
    worktreeEntries,
    mainSha,
    devSha
  };

  console.log('--- REPORTE DE RAMAS LOCALES (feat/*) ---');
  for (const b of localFeats) {
    const info = analyzeBranch(b, false, env);
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
    const info = analyzeBranch(b, true, env);
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

// Exportar funciones puras para testeo unitario
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    gitExec,
    fetchAllPRs,
    analyzeBranch,
    ALLOWED_GIT_SUBCOMMANDS,
    CANONICAL_TARGETS
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error fatal en ejecución de auditoría:', err);
    process.exit(1);
  });
}
