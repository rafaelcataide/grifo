// Confere que todos os arquivos JavaScript do app e do service worker compilam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const modules = [
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f)),
  join(root, 'config.js'),
  join(root, 'supabase', 'functions', '_shared', 'ai-tasks.js'),
];

for (const file of modules) {
  test(`compila: ${file.slice(root.length)}`, () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(file) });
    assert.equal(r.status, 0, r.stderr.toString());
  });
}

test('compila: sw.js (service worker, script clássico)', () => {
  const r = spawnSync(process.execPath, ['--check', join(root, 'sw.js')]);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('service worker lista os arquivos que existem', () => {
  const sw = readFileSync(join(root, 'sw.js'), 'utf8');
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1)).filter((p) => p !== './');
  for (const p of list) assert.doesNotThrow(() => readFileSync(join(root, p)), `sw.js lista ${p}, que não existe`);
});

test('todo ícone usado pelo app existe no sprite', () => {
  const icons = readFileSync(join(root, 'js', 'icons.js'), 'utf8');
  const sprite = readFileSync(join(root, 'icons', 'ui.svg'), 'utf8');
  const names = new Set([...icons.matchAll(/'[^']+': '([a-z0-9-]+)'/g)].map((m) => m[1]));
  const faltando = [...names].filter((n) => !sprite.includes(`<symbol id="${n}"`));
  assert.deepEqual(faltando, []);
});
