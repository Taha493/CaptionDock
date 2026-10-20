// Project checks that need no installed packages:
//   1. manifest.json is valid JSON and every file it points to exists
//   2. every .js file passes a syntax check (node --check)
//   3. no em dashes in code, docs or UI strings (project style rule)
//   4. no innerHTML / eval style calls in src (YouTube enforces Trusted Types)
// Run with: node scripts/check.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
let failures = 0;

const fail = (msg) => {
  failures++;
  console.error('  FAIL ' + msg);
};
const ok = (msg) => console.log('  ok   ' + msg);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p);
const files = walk(ROOT);

console.log('manifest.json');
let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  ok('valid JSON');
} catch (err) {
  fail('manifest.json is not valid JSON: ' + err.message);
}
if (manifest) {
  if (manifest.manifest_version === 3) ok('Manifest V3');
  else fail('manifest_version must be 3');
  const referenced = [
    ...Object.values(manifest.icons || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])]),
  ];
  for (const file of referenced) {
    if (fs.existsSync(path.join(ROOT, file))) ok('exists: ' + file);
    else fail('missing file referenced by manifest: ' + file);
  }
  const perms = manifest.permissions || [];
  if (perms.length === 1 && perms[0] === 'storage') ok('permissions: storage only');
  else fail('unexpected permissions: ' + JSON.stringify(perms));
}

console.log('syntax');
for (const file of files.filter((f) => f.endsWith('.js'))) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    ok(rel(file));
  } catch (err) {
    fail(rel(file) + '\n' + String(err.stderr || err.message));
  }
}

console.log('style and safety');
const EM_DASH = String.fromCharCode(0x2014);
const TEXT_EXT = new Set(['.js', '.json', '.css', '.md', '.xml', '.vtt', '.html']);
for (const file of files.filter((f) => TEXT_EXT.has(path.extname(f)))) {
  const text = fs.readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (line.includes(EM_DASH)) fail(`em dash in ${rel(file)}:${i + 1}`);
  });
}
const UNSAFE = /\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(/;
for (const file of files.filter((f) => f.startsWith(path.join(ROOT, 'src')) && f.endsWith('.js'))) {
  fs.readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (UNSAFE.test(line)) fail(`unsafe DOM/eval call in ${rel(file)}:${i + 1}: ${line.trim()}`);
    });
}
if (!failures) ok('no em dashes, no innerHTML/eval in src');

console.log(failures ? `\n${failures} problem(s) found.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
