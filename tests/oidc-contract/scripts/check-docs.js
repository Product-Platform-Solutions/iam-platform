// Fails if a test id (D01, A05, ...) is defined in test/*.test.js but missing from the docs table, or vice versa.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const testDir = new URL('../test/', import.meta.url).pathname;
const docPath = new URL('../../../docs/testing/oidc-contract-tests.md', import.meta.url).pathname;

const inTests = new Set();
for (const f of readdirSync(testDir).filter((n) => n.endsWith('.test.js'))) {
  for (const m of readFileSync(join(testDir, f), 'utf8').matchAll(/test\('\[[^\]]+\] ([A-Z]\d{2}):/g)) inTests.add(m[1]);
}
const inDoc = new Set([...readFileSync(docPath, 'utf8').matchAll(/^\| ([A-Z]\d{2}) \|/gm)].map((m) => m[1]));

const missingInDoc = [...inTests].filter((i) => !inDoc.has(i));
const missingInTests = [...inDoc].filter((i) => !inTests.has(i));
console.log(`${inTests.size} tests, ${inDoc.size} documented`);
if (missingInDoc.length) console.error('In tests but not in docs:', missingInDoc.join(', '));
if (missingInTests.length) console.error('In docs but not in tests:', missingInTests.join(', '));
process.exit(missingInDoc.length || missingInTests.length ? 1 : 0);
