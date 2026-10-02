#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyNewPath, compareVersions, inferRepositoryArea, normalizeVersion, stableReleaseQuarantine } from '../tools/update-anki-stable.mjs';

assert.equal(normalizeVersion('v26.09.4'), '26.09.4');
assert.equal(normalizeVersion('26.09.4'), '26.09.4');
assert.equal(compareVersions('26.09.4', '26.09.3'), 1);
assert.equal(compareVersions('26.10', '26.09.10'), 1);
assert.equal(compareVersions('26.09.3', '26.09.3'), 0);
assert.equal(compareVersions('26.09.1', '26.09.3'), -1);

const published='2026-10-01T12:00:00.000Z';
const before=stableReleaseQuarantine(published,48,Date.parse('2026-10-03T11:59:59.999Z'));
assert.equal(before.quarantined,true);
assert.equal(before.eligible_at,'2026-10-03T12:00:00.000Z');
assert.ok(before.remaining_ms>0);
const atLimit=stableReleaseQuarantine(published,48,Date.parse('2026-10-03T12:00:00.000Z'));
assert.equal(atLimit.quarantined,false);
assert.equal(atLimit.remaining_ms,0);
assert.throws(()=>stableReleaseQuarantine('',48),/published_at/);
assert.throws(()=>stableReleaseQuarantine(published,-1),/quarentena/);

assert.equal(inferRepositoryArea('.github/workflows/ci.yml'), 'github_ci');
assert.equal(inferRepositoryArea('rslib/src/scheduler/foo.rs'), 'rslib');
assert.equal(inferRepositoryArea('ts/routes/reviewer/foo.ts'), 'ts');
assert.equal(inferRepositoryArea('docs/changes.md'), 'docs');

assert.deepEqual(classifyNewPath('docs/new-release-note.md'), {
  repository_area:'docs', cards_scope:'OUTSIDE_CARDS_RUNTIME', cards_category:null
});
assert.deepEqual(classifyNewPath('qt/installer/new-helper.py'), {
  repository_area:'qt', cards_scope:'OUTSIDE_CARDS_RUNTIME', cards_category:null
});
assert.equal(classifyNewPath('rslib/src/scheduler/new_rule.rs').cards_scope, 'UNCLASSIFIED');
assert.equal(classifyNewPath('pylib/anki/new_runtime.py').cards_scope, 'UNCLASSIFIED');
assert.equal(classifyNewPath('ts/routes/reviewer/new_action.ts').cards_scope, 'UNCLASSIFIED');

console.log('ANKI AUTO UPDATE: versão, quarentena 48h, classificação conservadora e bloqueio de novos arquivos funcionais validados.');
