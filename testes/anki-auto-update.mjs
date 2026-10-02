#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyNewPath, compareVersions, inferRepositoryArea, normalizeVersion } from '../tools/update-anki-stable.mjs';

assert.equal(normalizeVersion('v26.09.4'), '26.09.4');
assert.equal(normalizeVersion('26.09.4'), '26.09.4');
assert.equal(compareVersions('26.09.4', '26.09.3'), 1);
assert.equal(compareVersions('26.10', '26.09.10'), 1);
assert.equal(compareVersions('26.09.3', '26.09.3'), 0);
assert.equal(compareVersions('26.09.2', '26.09.3'), -1);

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

console.log('ANKI AUTO UPDATE: versão, classificação conservadora e bloqueio de novos arquivos funcionais validados.');
