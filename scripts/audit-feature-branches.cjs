#!/usr/bin/env node
/**
 * scripts/audit-feature-branches.cjs
 * Herramienta de auditoría e inventario para el ciclo de vida de ramas feat/*.
 * ESTRICTAMENTE INFORMATIVA - NO EJECUTA OPERACIONES DESTRUCTIVAS.
 */

const { execSync } = require('child_process');

function exec(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch (e) {
    return null;
  }
}

function getGitHubToken() {
  try {
    const creds = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString();
    const match = creds.match(/password=(.+)/);
    return match ? match[1].trim() : null;
  } catch (e) {
    return process.env.GITHUB_TOKEN || null;
  }
}

async function fetchPRs(token) {
  if (!token) return [];
  try {
    const res = await fetch('https://api.github.com/repos/Lucasm282021/muro-participativo-de-ideas/pulls?state=all&per_page=100', {
      headers: { 'Authorization': 'token ' + token, 'User-Agent': 'Node-Audit' }
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (e) {
    return [];
  }
}

async function main() {
  console.log('===============================================================');
  console.log(' AUDITORÍA DE CICLO DE VIDA DE RAMAS FEATURE (feat/*)');
  console.log(' Repositorio: Lucasm282021/muro-participativo-de-ideas');
  console.log('===============================================================\n');

  const mainSha = exec('git rev-parse origin/main') || exec('git rev-parse main');
  const devSha = exec('git rev-parse origin/Dev') || exec('git rev-parse Dev');
  console.log(`Punteros canónicos:`);
  console.log(`  origin/main: ${mainSha || 'No encontrado'}`);
  console.log(`  origin/Dev:  ${devSha || 'No encontrado'}\n`);

  // Obtener worktrees activos
  const worktreeRaw = exec('git worktree list --porcelain') || '';
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

  // Obtener token y PRs
  const token = getGitHubToken();
  const prs = await fetchPRs(token);

  // Listar ramas
  const branchRaw = exec('git branch -a') || '';
  const lines = branchRaw.split('\n').map(l => l.replace(/^[*+ ]+/, '').trim()).filter(Boolean);

  const localFeats = lines.filter(b => b.startsWith('feat/'));
  const remoteFeats = lines.filter(b => b.startsWith('remotes/origin/feat/')).map(b => b.replace('remotes/origin/', ''));

  console.log(`Ramas locales detectadas: ${localFeats.length}`);
  console.log(`Ramas remotas detectadas: ${remoteFeats.length}\n`);

  const currentBranch = exec('git branch --show-current');

  function analyzeBranch(branchName, isRemote = false) {
    const fullRef = isRemote ? `origin/${branchName}` : branchName;
    const sha = exec(`git rev-parse "${fullRef}"`);
    if (!sha) return null;

    // Buscar PR asociado por head.ref
    const associatedPr = prs.find(p => p.head && p.head.ref === branchName);

    // Contención por ancestría directa
    const inMainAncestry = exec(`git merge-base --is-ancestor "${fullRef}" origin/main`) !== null;
    const inDevAncestry = exec(`git merge-base --is-ancestor "${fullRef}" origin/Dev`) !== null;

    // Commits exclusivos respecto a main y Dev
    const aheadMain = parseInt(exec(`git rev-list --count "origin/main..${fullRef}"`) || '0', 10);
    const aheadDev = parseInt(exec(`git rev-list --count "origin/Dev..${fullRef}"`) || '0', 10);

    // Diferencias de contenido contra origin/main
    const diffStat = exec(`git diff "${fullRef}" origin/main --stat`) || '';
    const diffLines = diffStat.split('\n').filter(Boolean);
    const diffSummary = diffLines.length > 0 ? diffLines[diffLines.length - 1].trim() : 'Sin diferencias de archivos';

    // Worktree asociado
    const wt = worktreeEntries.find(w => w.branch === branchName || (isRemote && w.head === sha));

    // Determinar categoría y recomendación
    let category = 'D'; // Por defecto dudoso
    let recommendation = 'Requiere análisis manual';
    let rationale = '';

    // Si es la rama activa en el repositorio principal, protegerla
    if (!isRemote && branchName === currentBranch) {
      category = 'C';
      recommendation = 'CONSERVAR';
      rationale = 'Rama activa en el repositorio principal de trabajo (protegida).';
    } else if (associatedPr && associatedPr.merged_at) {
      category = 'A';
      recommendation = 'APTA PARA ELIMINACIÓN';
      rationale = `PR #${associatedPr.number} fusionado en ${associatedPr.base.ref} el ${associatedPr.merged_at}.`;
    } else if (inMainAncestry || inDevAncestry) {
      category = 'A';
      recommendation = 'APTA PARA ELIMINACIÓN';
      rationale = `Contenida por ancestría directa en ${inMainAncestry ? 'main' : 'Dev'}.`;
    } else if (associatedPr && associatedPr.state === 'closed' && !associatedPr.merged_at) {
      category = 'B';
      recommendation = 'EVALUAR / VERIFICAR SI FUE INTEGRADA POR PROMO';
      rationale = `PR #${associatedPr.number} cerrado sin merge.`;
    } else if (aheadMain > 0 && aheadDev > 0) {
      category = 'C';
      recommendation = 'CONSERVAR (TRABAJO ACTIVO)';
      rationale = `Contiene commits exclusivos no integrados (${aheadMain} vs main, ${aheadDev} vs Dev).`;
    }

    return {
      branchName,
      isRemote,
      sha,
      associatedPr: associatedPr ? `#${associatedPr.number} (${associatedPr.state}${associatedPr.merged_at ? ', merged' : ''})` : 'Ninguno',
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
  console.error('Error en auditoría:', err);
  process.exit(1);
});
