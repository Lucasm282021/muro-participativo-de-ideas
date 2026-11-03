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
 *      aquellas con merged_at != null, destino canónico ('main' o 'Dev') y commit de integración
 *      verificado en la historia remota actual.
 *    - Falsos positivos por límites de paginación: si se alcanza el tope de páginas sin confirmar
 *      el final de la colección, se devuelve pagination_error y se rechazan recomendaciones de borrado.
 *    - PRs de otros repositorios o forks: se exige comprobación de head.repo.full_name coincidente.
 *    - Falsos positivos por consultas Git fallidas: si falla cualquier consulta general imprescindible
 *      (worktree list, branch -a, punteros origin/main u origin/Dev), la auditoría se detiene
 *      con código distinto de cero y nunca emite inventarios incompletos.
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

// Repositorio y destinos canónicos autorizados
const CANONICAL_REPO = 'Lucasm282021/muro-participativo-de-ideas';
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
 * Extrae credenciales de GitHub de forma segura.
 * Orden de precedencia documentado:
 * 1. Variable de entorno GITHUB_TOKEN
 * 2. Variable de entorno GH_TOKEN
 * 3. Almacén de credenciales de Git (git credential fill para host=github.com)
 *
 * Nunca registra ni imprime tokens ni secretos.
 */
function getGitHubToken(env = process.env, customGitExec = gitExec) {
  if (env.GITHUB_TOKEN && typeof env.GITHUB_TOKEN === 'string' && env.GITHUB_TOKEN.trim().length > 0) {
    return env.GITHUB_TOKEN.trim();
  }
  if (env.GH_TOKEN && typeof env.GH_TOKEN === 'string' && env.GH_TOKEN.trim().length > 0) {
    return env.GH_TOKEN.trim();
  }
  try {
    const res = customGitExec(['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n'
    });
    if (res.ok && res.stdout) {
      const match = res.stdout.match(/password=(.+)/);
      if (match && match[1].trim().length > 0) {
        return match[1].trim();
      }
    }
  } catch (e) {
    // Falla silenciosa sin exponer información
  }
  return null;
}

/**
 * Consulta exhaustiva y paginada de Pull Requests en la API de GitHub.
 * Recorre todas las páginas necesarias, detecta duplicados y gestiona errores por página.
 *
 * Control de límite de paginación (Corrección A):
 * - Si se alcanza maxPages y la última página contiene 100 registros sin confirmar el fin,
 *   devuelve status 'pagination_error' para evitar dar por completa una colección truncada.
 */
async function fetchAllPRs(token, maxPages = 50, customFetch = (typeof fetch !== 'undefined' ? fetch : null)) {
  if (!token) {
    return {
      status: 'no_token',
      prs: [],
      pagesFetched: 0,
      message: 'No se detectó token de autenticación (GITHUB_TOKEN, GH_TOKEN ni git credential fill)'
    };
  }

  if (!customFetch) {
    return {
      status: 'network_error',
      prs: [],
      pagesFetched: 0,
      message: 'Cliente fetch no disponible en el entorno'
    };
  }

  const allPrs = [];
  const seenIds = new Set();
  let page = 1;

  while (page <= maxPages) {
    const url = `https://api.github.com/repos/${CANONICAL_REPO}/pulls?state=all&per_page=100&page=${page}`;
    let res;
    try {
      res = await customFetch(url, {
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

    // Fin confirmado de la colección (página vacía)
    if (data.length === 0) {
      break;
    }

    for (const pr of data) {
      if (pr && pr.id && !seenIds.has(pr.id)) {
        seenIds.add(pr.id);
        allPrs.push(pr);
      }
    }

    // Menos de 100 registros confirma el final de la colección
    if (data.length < 100) {
      break;
    }

    // Si se alcanzó el límite máximo de páginas y trajo 100 registros, la colección está incompleta
    if (page === maxPages) {
      return {
        status: 'pagination_error',
        prs: allPrs,
        pagesFetched: page,
        message: `Consulta incompleta por alcanzar límite de paginación (${maxPages} páginas) sin confirmar el final de la colección (${allPrs.length} PRs recuperados)`
      };
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
function analyzeBranch(branchName, isRemote, env, customGitExec = gitExec) {
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

  // Comprobar disponibilidad de punteros canónicos
  if (!mainSha || !devSha) {
    return {
      branchName,
      isRemote,
      sha: 'no verificable',
      associatedPr: 'No consultado',
      inMainAncestry: false,
      inDevAncestry: false,
      aheadMain: null,
      aheadDev: null,
      diffSummary: 'Punteros canónicos remotos no disponibles',
      worktree: 'Ninguno',
      category: 'D',
      recommendation: 'DETENER / PUNTEROS CANÓNICOS AUSENTES',
      rationale: `Faltan punteros canónicos obligatorios (${!mainSha ? 'origin/main ' : ''}${!devSha ? 'origin/Dev' : ''}). No es seguro emitir dictamen.`
    };
  }

  // 1. Resolver SHA de la rama usando referencia canónica desambiguada
  const fullRef = isRemote ? `refs/remotes/origin/${branchName}` : `refs/heads/${branchName}`;
  const shaRes = customGitExec(['rev-parse', '--verify', fullRef]);
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

  // 2. Asociar PRs con verificación de repositorio de origen (Corrección D)
  let associatedPrText = 'No consultable';
  const canonicalRepoPrs = [];
  const foreignOrUnverifiedPrs = [];

  if (githubResult && githubResult.status === 'success') {
    const matchingHeadRef = (githubResult.prs || []).filter(p => p.head && p.head.ref === branchName);

    for (const pr of matchingHeadRef) {
      const repoFullName = pr.head.repo ? pr.head.repo.full_name : null;
      if (repoFullName === CANONICAL_REPO) {
        canonicalRepoPrs.push(pr);
      } else {
        foreignOrUnverifiedPrs.push({
          pr,
          repoFullName: repoFullName || 'repositorio desconocido / eliminado'
        });
      }
    }

    if (canonicalRepoPrs.length > 0) {
      associatedPrText = canonicalRepoPrs.map(p => {
        const mergeState = p.merged_at ? `merged->${p.base.ref}` : p.state;
        return `#${p.number} (${mergeState})`;
      }).join(', ');
    } else if (foreignOrUnverifiedPrs.length > 0) {
      associatedPrText = foreignOrUnverifiedPrs.map(item =>
        `#${item.pr.number} (origen no canónico: ${item.repoFullName})`
      ).join(', ');
    } else {
      associatedPrText = 'Ninguno (confirmado en GitHub)';
    }
  } else if (githubResult) {
    associatedPrText = `No disponible (${githubResult.message})`;
  }

  // 3. Comprobar contención en Git con tratamiento explícito de errores (Corrección C)
  let gitQueryError = null;
  const canonicalMainRef = 'refs/remotes/origin/main';
  const canonicalDevRef = 'refs/remotes/origin/Dev';

  // 3a. Ancestría directa en origin/main
  let inMainAncestry = false;
  const mainAncRes = customGitExec(['merge-base', '--is-ancestor', fullRef, canonicalMainRef]);
  if (mainAncRes.exitCode === 0) {
    inMainAncestry = true;
  } else if (mainAncRes.exitCode === 1) {
    inMainAncestry = false;
  } else {
    gitQueryError = `Fallo en merge-base ${canonicalMainRef}: ${mainAncRes.stderr || mainAncRes.error?.message}`;
  }

  // 3b. Ancestría directa en origin/Dev
  let inDevAncestry = false;
  if (!gitQueryError) {
    const devAncRes = customGitExec(['merge-base', '--is-ancestor', fullRef, canonicalDevRef]);
    if (devAncRes.exitCode === 0) {
      inDevAncestry = true;
    } else if (devAncRes.exitCode === 1) {
      inDevAncestry = false;
    } else {
      gitQueryError = `Fallo en merge-base ${canonicalDevRef}: ${devAncRes.stderr || devAncRes.error?.message}`;
    }
  }

  // 3c. Commits exclusivos
  let aheadMain = null;
  let aheadDev = null;
  if (!gitQueryError) {
    const aheadMainRes = customGitExec(['rev-list', '--count', `${canonicalMainRef}..${fullRef}`]);
    if (aheadMainRes.ok) {
      aheadMain = parseInt(aheadMainRes.stdout, 10);
    } else {
      gitQueryError = `Fallo en rev-list ${canonicalMainRef}: ${aheadMainRes.stderr}`;
    }
  }

  if (!gitQueryError) {
    const aheadDevRes = customGitExec(['rev-list', '--count', `${canonicalDevRef}..${fullRef}`]);
    if (aheadDevRes.ok) {
      aheadDev = parseInt(aheadDevRes.stdout, 10);
    } else {
      gitQueryError = `Fallo en rev-list ${canonicalDevRef}: ${aheadDevRes.stderr}`;
    }
  }

  // 3d. Diferencias de contenido contra origin/main
  let diffSummary = 'Sin diferencias de archivos';
  if (!gitQueryError) {
    const diffRes = customGitExec(['diff', '--stat', fullRef, canonicalMainRef]);
    if (diffRes.ok) {
      const diffLines = diffRes.stdout.split('\n').filter(Boolean);
      diffSummary = diffLines.length > 0 ? diffLines[diffLines.length - 1].trim() : 'Sin diferencias de archivos';
    } else {
      gitQueryError = `Fallo en diff ${canonicalMainRef}: ${diffRes.stderr}`;
      diffSummary = 'Error al calcular diferencias';
    }
  }

  // 4. Worktree asociado
  const wt = (worktreeEntries || []).find(w => w.branch === branchName || (isRemote && w.head === sha));

  // 5. Verificación de integración efectiva del PR (Corrección B)
  const canonicalMergedPr = canonicalRepoPrs.find(p => p.merged_at && CANONICAL_TARGETS.has(p.base.ref));
  const nonCanonicalMergedPr = canonicalRepoPrs.find(p => p.merged_at && !CANONICAL_TARGETS.has(p.base.ref));
  const openPr = canonicalRepoPrs.find(p => p.state === 'open');
  const closedUnmergedPr = canonicalRepoPrs.find(p => p.state === 'closed' && !p.merged_at);

  let mergeCommitVerified = false;
  let mergeCommitError = null;

  if (canonicalMergedPr) {
    const mergeSha = canonicalMergedPr.merge_commit_sha;
    if (!mergeSha || typeof mergeSha !== 'string' || mergeSha.trim().length === 0) {
      mergeCommitError = `PR #${canonicalMergedPr.number} figura fusionado pero carece de merge_commit_sha en GitHub`;
    } else {
      const targetRef = canonicalMergedPr.base.ref === 'main' ? canonicalMainRef : canonicalDevRef;
      const targetAncestryRes = customGitExec(['merge-base', '--is-ancestor', mergeSha.trim(), targetRef]);
      if (targetAncestryRes.exitCode === 0) {
        mergeCommitVerified = true;
      } else if (targetAncestryRes.exitCode === 1) {
        mergeCommitError = `El commit de integración ${mergeSha.trim().substring(0, 7)} del PR #${canonicalMergedPr.number} no está contenido en ${targetRef}`;
      } else {
        mergeCommitError = `Error de Git al verificar integración de ${mergeSha.trim().substring(0, 7)} en ${targetRef}: ${targetAncestryRes.stderr || targetAncestryRes.error?.message}`;
      }
    }
  }

  // 6. Clasificación segura con política conservadora fail-closed
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
  } else if (!githubResult || githubResult.status !== 'success') {
    category = 'D';
    recommendation = 'DETENER / CONSULTA GITHUB PENDIENTE O INCOMPLETA';
    rationale = `No se pudo verificar fehacientemente el estado de PR en GitHub (${githubResult ? githubResult.message : 'sin consulta'}). No es seguro recomendar eliminación.`;
  } else if (foreignOrUnverifiedPrs.length > 0 && canonicalRepoPrs.length === 0) {
    category = 'D';
    recommendation = 'DETENER / PR DE OTRO REPOSITORIO O NO VERIFICABLE';
    rationale = `Se detectó coincidencia de nombre de rama pero asociada a repositorios externos o no verificables (${foreignOrUnverifiedPrs.map(f => `#${f.pr.number} de ${f.repoFullName}`).join(', ')}). Exige verificación manual.`;
  } else if (openPr) {
    category = 'C';
    recommendation = 'CONSERVAR (PR ABIERTO)';
    rationale = `PR #${openPr.number} abierto hacia [${openPr.base.ref}]. Trabajo en curso o revisión.`;
  } else if (canonicalMergedPr) {
    if (mergeCommitVerified) {
      category = 'A';
      recommendation = 'APTA PARA ELIMINACIÓN';
      const targetRef = canonicalMergedPr.base.ref === 'main' ? 'origin/main' : 'origin/Dev';
      rationale = `PR #${canonicalMergedPr.number} fusionado exitosamente hacia destino canónico [${canonicalMergedPr.base.ref}] el ${canonicalMergedPr.merged_at} y su commit de integración (${canonicalMergedPr.merge_commit_sha.substring(0, 7)}) está contenido en ${targetRef}.`;
    } else {
      category = 'D';
      recommendation = 'DETENER / INTEGRACIÓN NO VERIFICADA EN DESTINO';
      rationale = `PR #${canonicalMergedPr.number} figura cerrado/fusionado pero no pudo verificarse su integración efectiva: ${mergeCommitError}.`;
    }
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
  } else if (aheadMain !== null && aheadDev !== null && aheadMain > 0 && aheadDev > 0) {
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
  console.log(` Repositorio: ${CANONICAL_REPO}`);
  console.log(' Modo: Estrictamente Informativo (Solo Lectura)');
  console.log('===============================================================\n');

  // 1. Verificación obligatoria de punteros canónicos
  const mainShaRes = gitExec(['rev-parse', '--verify', 'refs/remotes/origin/main']);
  if (!mainShaRes.ok || !mainShaRes.stdout) {
    console.error(`ERROR CRÍTICO: No se pudo resolver el puntero canónico obligatorio refs/remotes/origin/main: ${mainShaRes.stderr}`);
    process.exit(1);
  }
  const mainSha = mainShaRes.stdout;

  const devShaRes = gitExec(['rev-parse', '--verify', 'refs/remotes/origin/Dev']);
  if (!devShaRes.ok || !devShaRes.stdout) {
    console.error(`ERROR CRÍTICO: No se pudo resolver el puntero canónico obligatorio refs/remotes/origin/Dev: ${devShaRes.stderr}`);
    process.exit(1);
  }
  const devSha = devShaRes.stdout;

  console.log('Punteros canónicos:');
  console.log(`  origin/main: ${mainSha}`);
  console.log(`  origin/Dev:  ${devSha}\n`);

  // 2. Consulta obligatoria de worktrees activos
  const worktreeRes = gitExec(['worktree', 'list', '--porcelain']);
  if (!worktreeRes.ok) {
    console.error(`ERROR CRÍTICO: Falló la consulta de worktrees activos: ${worktreeRes.stderr}`);
    process.exit(1);
  }
  const worktreeEntries = [];
  if (worktreeRes.stdout) {
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
  }

  // 3. Consulta obligatoria de rama activa
  const currentBranchRes = gitExec(['branch', '--show-current']);
  if (!currentBranchRes.ok) {
    console.error(`ERROR CRÍTICO: Falló la identificación de la rama activa: ${currentBranchRes.stderr}`);
    process.exit(1);
  }
  const currentBranch = currentBranchRes.stdout;

  // 4. Consulta obligatoria de ramas locales y remotas
  const branchRes = gitExec(['branch', '-a']);
  if (!branchRes.ok) {
    console.error(`ERROR CRÍTICO: Falló el listado de ramas (git branch -a): ${branchRes.stderr}`);
    process.exit(1);
  }
  const lines = branchRes.stdout.split('\n').map(l => l.replace(/^[*+ ]+/, '').trim()).filter(Boolean);
  const localFeats = lines.filter(b => b.startsWith('feat/'));
  const remoteFeats = lines.filter(b => b.startsWith('remotes/origin/feat/')).map(b => b.replace('remotes/origin/', ''));

  // 5. Consultar estado de GitHub API con paginación completa y límite seguro
  const token = getGitHubToken();
  const githubResult = await fetchAllPRs(token);
  console.log(`Estado de GitHub API: [${githubResult.status}] ${githubResult.message}\n`);

  console.log(`Ramas locales detectadas: ${localFeats.length}`);
  console.log(`Ramas remotas detectadas: ${remoteFeats.length}\n`);

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
    getGitHubToken,
    fetchAllPRs,
    analyzeBranch,
    ALLOWED_GIT_SUBCOMMANDS,
    CANONICAL_TARGETS,
    CANONICAL_REPO
  };
}

if (require.main === module) {
  main().catch(err => {
    console.error('Error fatal en ejecución de auditoría:', err);
    process.exit(1);
  });
}
