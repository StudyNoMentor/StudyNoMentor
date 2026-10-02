#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ANKI_DIR = join(ROOT, 'anki-oficial');
const UPSTREAM = join(ANKI_DIR, 'upstream');
const INVENTORY_DIR = join(ANKI_DIR, 'inventario');
const LOCK_PATH = join(ANKI_DIR, 'UPSTREAM.lock.json');
const CONTRACTS_PATH = join(ANKI_DIR, 'cards-contracts.json');

const exec = (cmd, args, opts = {}) => execFileSync(cmd, args, {
  cwd: ROOT,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  maxBuffer: 64 * 1024 * 1024,
  ...opts,
}).trim();

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, value) => writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const uniq = xs => [...new Set(xs)];

export function normalizeVersion(raw) {
  return String(raw || '').trim().replace(/^v(?=\d)/i, '');
}

export function compareVersions(a, b) {
  const aa = normalizeVersion(a).split(/[.-]/).map(x => /^\d+$/.test(x) ? Number(x) : x);
  const bb = normalizeVersion(b).split(/[.-]/).map(x => /^\d+$/.test(x) ? Number(x) : x);
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) {
    const x = aa[i] ?? 0, y = bb[i] ?? 0;
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x > y ? 1 : -1;
    } else {
      const sx = String(x), sy = String(y);
      if (sx !== sy) return sx > sy ? 1 : -1;
    }
  }
  return 0;
}

export function stableReleaseQuarantine(publishedAt, quarantineHours, nowMs = Date.now()) {
  const hours = Number(quarantineHours);
  if (!Number.isFinite(hours) || hours < 0) throw new Error('Política de quarentena inválida: '+quarantineHours);
  const publishedMs = Date.parse(String(publishedAt || ''));
  if (!Number.isFinite(publishedMs)) throw new Error('Release estável sem published_at oficial válido; promoção automática recusada.');
  const eligibleMs = publishedMs + hours * 60 * 60 * 1000;
  const remainingMs = Math.max(0, eligibleMs - Number(nowMs));
  return {
    quarantined: remainingMs > 0,
    published_at: new Date(publishedMs).toISOString(),
    eligible_at: new Date(eligibleMs).toISOString(),
    remaining_ms: remainingMs,
    remaining_hours: remainingMs / (60 * 60 * 1000),
  };
}

export function inferRepositoryArea(path) {
  const p = String(path || '');
  if (p.startsWith('.github/')) return 'github_ci';
  if (p.startsWith('docs/')) return 'docs';
  if (p.startsWith('ftl/')) return 'localization';
  if (p.startsWith('proto/')) return 'proto';
  if (p.startsWith('pylib/')) return 'pylib';
  if (p.startsWith('python/')) return 'python';
  if (p.startsWith('qt/')) return 'qt';
  if (p.startsWith('rslib/')) return 'rslib';
  if (p.startsWith('ts/')) return 'ts';
  if (/^(?:build|ninja|tools|bazel|cargo|out|scripts?)\//.test(p)) return 'build_tools';
  return 'other';
}

export function classifyNewPath(path) {
  const p = String(path || '');
  const area = inferRepositoryArea(p);
  const safeOutside =
    ['github_ci', 'docs', 'localization', 'build_tools'].includes(area) ||
    p.startsWith('qt/installer/') ||
    /^(?:LICENSE|COPYING|README(?:\.[^/]*)?|CONTRIBUTING(?:\.[^/]*)?|SECURITY(?:\.[^/]*)?|\.gitignore|\.gitattributes|\.editorconfig)$/.test(p);
  return {
    repository_area: area,
    cards_scope: safeOutside ? 'OUTSIDE_CARDS_RUNTIME' : 'UNCLASSIFIED',
    cards_category: null,
  };
}

function setOutput(name, value) {
  const p = process.env.GITHUB_OUTPUT;
  if (!p) return;
  const text = String(value ?? '');
  const marker = '__ANKI_UPDATE_EOF__';
  appendFileSync(p, `${name}<<${marker}\n${text}\n${marker}\n`);
}

async function githubJson(path) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'StudyNoMentor-Anki-Stable-Updater',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const r = await fetch('https://api.github.com' + path, { headers });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
  return r.json();
}

async function resolveRelease(target) {
  let release;
  if (target) {
    const tries = uniq([target, normalizeVersion(target), 'v' + normalizeVersion(target)]);
    let last;
    for (const tag of tries) {
      try {
        release = await githubJson('/repos/ankitects/anki/releases/tags/' + encodeURIComponent(tag));
        break;
      } catch (e) { last = e; }
    }
    if (!release) throw last || new Error('Release Anki não encontrada: ' + target);
  } else {
    release = await githubJson('/repos/ankitects/anki/releases/latest');
  }
  if (release.draft || release.prerelease) throw new Error('A atualização automática aceita somente release estável publicada.');
  const version = normalizeVersion(release.tag_name);
  if (!/^\d+(?:\.\d+)+$/.test(version)) throw new Error('Tag estável inesperada do Anki: ' + release.tag_name);
  return { version, tag: release.tag_name, release };
}

function oldInventory() {
  const files = readdirSync(INVENTORY_DIR)
    .filter(x => /^\d{4}-\d{4}\.json$/.test(x))
    .sort()
    .flatMap(x => readJson(join(INVENTORY_DIR, x)).files || []);
  return files;
}

function parseLsTree() {
  const raw = exec('git', ['-C', UPSTREAM, 'ls-tree', '-r', '-l', 'HEAD']);
  const blobs = [], submodules = [];
  for (const line of raw.split('\n').filter(Boolean)) {
    const m = /^(\d+)\s+(blob|commit)\s+([0-9a-f]{40})\s+(-|\d+)\t(.+)$/.exec(line);
    if (!m) continue;
    const [, mode, type, sha, sizeRaw, path] = m;
    if (type === 'blob') blobs.push({ mode, sha, size: Number(sizeRaw), path });
    if (type === 'commit' && mode === '160000') submodules.push({ path, commit: sha });
  }
  return { blobs, submodules };
}

function parseGitmodules() {
  let text = '';
  try { text = exec('git', ['-C', UPSTREAM, 'show', 'HEAD:.gitmodules']); } catch { return new Map(); }
  const out = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    const section = /^\s*\[submodule\s+"(.+)"\]\s*$/.exec(line);
    if (section) { current = { name: section[1], path: null, url: null }; continue; }
    if (!current) continue;
    const kv = /^\s*(path|url)\s*=\s*(.+?)\s*$/.exec(line);
    if (!kv) continue;
    current[kv[1]] = kv[2];
    if (current.path && current.url) {
      out.set(current.path, current.url);
      current = null;
    }
  }
  return out;
}

function repositoryFromUrl(url) {
  const s = String(url || '').replace(/\.git$/, '');
  const m = /github\.com[/:]([^/]+\/[\w.-]+)$/.exec(s);
  return m ? m[1] : s;
}

function replaceVersionInKnownFiles(oldVersion, newVersion) {
  const files = [
    'CONTRIBUINDO.md',
    'anki-oficial/README.md',
    'anki-oficial/CHECKLIST.md',
    'anki-oficial/PRODUCTION-DEPLOY.md',
    'anki_official_backend/NOTICE-ANKI.md',
    'anki_official_backend/app.py',
    'anki_official_backend/requirements.txt',
    'src/js/44-anki-max-stats-media.js',
    'src/js/44-tela-cards.js',
    'src/js/94-global-scope.js',
    'src/js/46-sanitizacao-e-editor.js',
    'src/js/95-cards-official-bridge.js',
    'testes/anki-oficial-backend-smoke.py',
    'testes/cards-official-bridge-static.mjs',
  ];
  for (const rel of files) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const before = readFileSync(p, 'utf8');
    const after = before.split(oldVersion).join(newVersion);
    if (after !== before) writeFileSync(p, after);
  }
}

function writeInventory(version, commit, oldFiles, tree, oldSubmodules) {
  const oldMap = new Map(oldFiles.map(x => [x.path, x]));
  const rows = tree.blobs.map((b, i) => {
    const prior = oldMap.get(b.path);
    const cls = prior ? {
      repository_area: prior.repository_area || inferRepositoryArea(b.path),
      cards_scope: prior.cards_scope,
      cards_category: prior.cards_category ?? null,
    } : classifyNewPath(b.path);
    return {
      index: i + 1,
      path: b.path,
      blob_sha: b.sha,
      size: b.size,
      ...cls,
    };
  });

  for (const name of readdirSync(INVENTORY_DIR)) {
    if (/^\d{4}-\d{4}\.json$/.test(name)) rmSync(join(INVENTORY_DIR, name));
  }
  const lock = readJson(LOCK_PATH);
  const chunkSize = Number(lock.inventory_chunk_size || 250);
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const from = i + 1, to = i + chunk.length;
    const name = String(from).padStart(4, '0') + '-' + String(to).padStart(4, '0') + '.json';
    writeJson(join(INVENTORY_DIR, name), {
      upstream_commit: commit,
      range: [from, to],
      files: chunk,
    });
  }

  writeFileSync(join(INVENTORY_DIR, 'README.md'), `# Inventário integral do upstream Anki ${version}

Gerado diretamente da Git tree do commit:

\`${commit}\`

Total: **${rows.length} blobs/arquivos**.

Os arquivos são divididos em blocos de ${chunkSize} entradas apenas para manter diffs revisáveis. A concatenação dos blocos, ordenada por \`index\`, é o inventário integral.

Campos:
- \`path\`: caminho oficial;
- \`blob_sha\`: SHA Git do conteúdo oficial;
- \`size\`: bytes informados pela Git tree;
- \`repository_area\`: área estrutural;
- \`cards_scope\`: \`CARDS_RUNTIME\`, \`OUTSIDE_CARDS_RUNTIME\` ou \`UNCLASSIFIED\`;
- \`cards_category\`: contrato funcional quando aplicável.

Arquivos novos em áreas potencialmente funcionais entram como \`UNCLASSIFIED\` e bloqueiam o merge automático até classificação explícita.
`);

  const gitmodules = parseGitmodules();
  const oldSubMap = new Map((oldSubmodules.submodules || []).map(x => [x.path, x]));
  const subs = tree.submodules.map(x => ({
    path: x.path,
    commit: x.commit,
    repository: repositoryFromUrl(gitmodules.get(x.path) || oldSubMap.get(x.path)?.repository || ''),
    cards_scope: oldSubMap.get(x.path)?.cards_scope || 'UNCLASSIFIED',
  }));
  writeJson(join(INVENTORY_DIR, 'submodules.json'), { upstream_commit: commit, submodules: subs });

  return { rows, submodules: subs };
}

function countBy(rows, key, predicate = () => true) {
  const out = {};
  for (const row of rows) {
    if (!predicate(row)) continue;
    const k = row[key] ?? 'null';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function updateContracts(version, commit, rows, blockers) {
  const contracts = readJson(CONTRACTS_PATH);
  const runtime = rows.filter(x => x.cards_scope === 'CARDS_RUNTIME');
  contracts.upstream_commit = commit;
  contracts.total_runtime_files = runtime.length;
  contracts.integration.runtime = 'anki==' + version;
  contracts.integration.integrated_runtime_files = runtime.length;
  contracts.integration.status = blockers.length ? 'UPSTREAM_REVIEW_REQUIRED' : 'OFFICIAL_RUNTIME_DELEGATION_COMPLETE';
  contracts.integration.coverage_percent = blockers.length ? 0 : 100;
  for (const [name, cat] of Object.entries(contracts.categories)) {
    cat.official_files = runtime.filter(x => x.cards_category === name).length;
  }
  writeJson(CONTRACTS_PATH, contracts);
}

function updateLock(version, commit, rows, mainRadar, blockers) {
  const lock = readJson(LOCK_PATH);
  const runtime = rows.filter(x => x.cards_scope === 'CARDS_RUNTIME');
  const outside = rows.filter(x => x.cards_scope === 'OUTSIDE_CARDS_RUNTIME');
  const unclassified = rows.filter(x => x.cards_scope === 'UNCLASSIFIED');
  lock.release = version;
  lock.release_commit = commit;
  lock.main_radar_commit = mainRadar || commit;
  lock.total_files = rows.length;
  lock.cards_runtime_files = runtime.length;
  lock.outside_cards_runtime_files = outside.length;
  lock.unclassified_files = unclassified.length;
  lock.repository_area_counts = countBy(rows, 'repository_area');
  lock.cards_category_counts = countBy(runtime, 'cards_category', x => !!x.cards_category);
  lock.auto_update = {
    safe_to_merge: blockers.length === 0,
    blockers,
    generated_at: new Date().toISOString(),
  };
  writeJson(LOCK_PATH, lock);
}

function replaceCommitReferences(oldCommit, newCommit) {
  const files = ['anki-oficial/README.md', 'anki-oficial/CHECKLIST.md'];
  for (const rel of files) {
    const p = join(ROOT, rel);
    const before = readFileSync(p, 'utf8');
    const after = before.split(oldCommit).join(newCommit);
    if (after !== before) writeFileSync(p, after);
  }
}

function prBody(oldVersion, version, commit, rows, blockers) {
  const runtime = rows.filter(x => x.cards_scope === 'CARDS_RUNTIME').length;
  const outside = rows.filter(x => x.cards_scope === 'OUTSIDE_CARDS_RUNTIME').length;
  const unclassified = rows.filter(x => x.cards_scope === 'UNCLASSIFIED').length;
  const blockerText = blockers.length
    ? blockers.slice(0, 100).map(x => '- ' + x).join('\n')
    : '- Nenhum. A atualização pode ser promovida automaticamente se a CI completa passar.';
  return `<!-- anki-stable-auto-update -->
# Atualização automática do Anki estável

**Versão:** ${oldVersion} → **${version}**  
**Commit upstream:** \`${commit}\`

Inventário regenerado a partir da Git tree oficial: **${rows.length} arquivos**, sendo **${runtime} runtime Cards**, **${outside} fora do runtime** e **${unclassified} não classificados**.

## Barreiras de segurança

${blockerText}

AUTO_UPDATE_BLOCKERS: ${blockers.length}

A produção só é atualizada depois da verificação completa (inventário, versão, build, runtime, backend real, concorrência e navegador). Se qualquer gate falhar, este PR permanece aberto e a versão anterior continua em produção.
`;
}

async function main() {
  const oldLock = readJson(LOCK_PATH);
  const oldVersion = oldLock.release;
  const oldCommit = oldLock.release_commit;
  const targetArg = process.argv.find(x => x.startsWith('--target='));
  const requested = process.env.ANKI_TARGET_VERSION || (targetArg ? targetArg.slice('--target='.length) : '');
  const { version, tag, release } = await resolveRelease(requested);

  if (compareVersions(version, oldVersion) < 0 && process.env.ANKI_ALLOW_DOWNGRADE !== '1') {
    throw new Error(`Release encontrada ${version} é anterior à versão fixada ${oldVersion}; downgrade automático recusado.`);
  }
  if (version === oldVersion) {
    console.log(`Anki ${oldVersion} já é a release estável fixada. Nenhuma alteração.`);
    setOutput('changed', 'false');
    setOutput('version', version);
    setOutput('blockers_count', '0');
    return;
  }

  const quarantineHours = Number(oldLock.auto_update_policy?.stable_release_quarantine_hours ?? 48);
  const quarantine = stableReleaseQuarantine(release.published_at, quarantineHours);
  if (quarantine.quarantined) {
    console.log(
      `Anki ${version} é estável, mas permanece em quarentena por ${quarantine.remaining_hours.toFixed(1)}h. ` +
      `Elegível a partir de ${quarantine.eligible_at}.`
    );
    setOutput('changed', 'false');
    setOutput('quarantined', 'true');
    setOutput('version', version);
    setOutput('published_at', quarantine.published_at);
    setOutput('eligible_at', quarantine.eligible_at);
    setOutput('quarantine_hours', String(quarantineHours));
    setOutput('blockers_count', '0');
    return;
  }
  setOutput('quarantined', 'false');
  setOutput('published_at', quarantine.published_at);
  setOutput('eligible_at', quarantine.eligible_at);
  setOutput('quarantine_hours', String(quarantineHours));

  if (!existsSync(join(UPSTREAM, '.git')) && !existsSync(join(UPSTREAM, 'rslib'))) {
    throw new Error('Submodule anki-oficial/upstream não inicializado. Use checkout com submodules: recursive.');
  }

  const oldFiles = oldInventory();
  const oldSubmodules = readJson(join(INVENTORY_DIR, 'submodules.json'));

  exec('git', ['-C', UPSTREAM, 'fetch', '--force', '--depth=1', 'origin', 'refs/tags/' + tag + ':refs/tags/' + tag]);
  const commit = exec('git', ['-C', UPSTREAM, 'rev-list', '-n', '1', tag]);
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Não foi possível resolver o commit da release ' + tag);
  exec('git', ['-C', UPSTREAM, 'checkout', '--detach', commit]);

  let mainRadar = commit;
  try {
    const line = exec('git', ['-C', UPSTREAM, 'ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0];
    if (/^[0-9a-f]{40}$/.test(line)) mainRadar = line;
  } catch {}

  const tree = parseLsTree();
  const { rows, submodules } = writeInventory(version, commit, oldFiles, tree, oldSubmodules);

  const blockers = [];
  for (const row of rows.filter(x => x.cards_scope === 'UNCLASSIFIED')) {
    blockers.push('Classificar arquivo upstream novo/renomeado: ' + row.path);
  }
  const oldSubPaths = new Set((oldSubmodules.submodules || []).map(x => x.path));
  for (const sub of submodules) {
    if (!oldSubPaths.has(sub.path)) blockers.push('Classificar novo submódulo upstream: ' + sub.path);
  }

  replaceVersionInKnownFiles(oldVersion, version);
  replaceCommitReferences(oldCommit, commit);
  updateContracts(version, commit, rows, blockers);
  updateLock(version, commit, rows, mainRadar, blockers);

  const body = prBody(oldVersion, version, commit, rows, blockers);
  writeFileSync(join(ROOT, '.git', 'anki-update-pr-body.md'), body);

  setOutput('changed', 'true');
  setOutput('version', version);
  setOutput('upstream_commit', commit);
  setOutput('blockers_count', String(blockers.length));
  setOutput('blockers', blockers.join('\n'));
  setOutput('pr_body_file', '.git/anki-update-pr-body.md');

  console.log(`Preparada atualização Anki ${oldVersion} -> ${version} (${commit}).`);
  console.log(`Inventário: ${rows.length} arquivos; bloqueadores automáticos: ${blockers.length}.`);
  if (blockers.length) console.log(blockers.slice(0, 30).map(x => '  - ' + x).join('\n'));
}

const invokedAsCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsCli) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exit(1);
  });
}
