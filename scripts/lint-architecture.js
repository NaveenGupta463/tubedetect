#!/usr/bin/env node
/**
 * Architecture boundary guard — run via: npm run lint:arch
 *
 * Checks that abstraction layers introduced in Stages 1-4 haven't been bypassed:
 *   - No direct localStorage.* calls outside src/utils/storage.js
 *   - No hardcoded localhost: URLs in fetch() calls outside src/config.js
 *   - No SQL keyword strings in server/routes/ files (should be in db/queries.js)
 *   - No import.meta.env references outside src/config.js
 *
 * Exits 0 if clean, exits 1 if violations found.
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, '..');

let violations = 0;

function findFiles(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules') {
      out.push(...findFiles(full, exts));
    } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

function check(files, pattern, message, allowList = []) {
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (allowList.some(a => rel.includes(a))) continue;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        console.error(`  VIOLATION [${rel}:${i + 1}] ${message}`);
        console.error(`    ${line.trim()}`);
        violations++;
      }
    });
  }
}

console.log('\n🔍 Architecture boundary check...\n');

const srcFiles   = findFiles(path.join(ROOT, 'src'), ['.js', '.jsx', '.ts', '.tsx']);
const routeFiles = findFiles(path.join(ROOT, 'server', 'routes'), ['.js']);

check(
  srcFiles,
  /localStorage\.(getItem|setItem|removeItem|clear)\s*\(/,
  'Direct localStorage call — use src/utils/storage.js instead',
  ['src/utils/storage.js'],
);

check(
  srcFiles,
  /fetch\s*\(\s*['"`]https?:\/\/localhost/,
  'Hardcoded localhost URL in fetch() — use ROUTES from src/config.js instead',
  ['src/config.js'],
);

check(
  routeFiles,
  /db\.(run|get|all|exec)\s*\(\s*[`'"]\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)/i,
  'Raw SQL in route file — move to server/db/queries.js',
  [],
);

check(
  srcFiles,
  /import\.meta\.env\./,
  'Direct import.meta.env access — import from src/config.js instead',
  ['src/config.js'],
);

console.log(violations === 0
  ? '✅  No architecture violations found.\n'
  : `\n❌  ${violations} violation(s) found. Fix before committing.\n`);

process.exit(violations > 0 ? 1 : 0);
