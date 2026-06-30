// Syntax-check a generated workflow script. `node --check` cannot validate
// these files because they use a top-level `return` (and top-level `await`):
// the Workflow runtime executes each script as the body of an async function,
// so `return`/`await` are legal there but illegal at ESM top level.
//
// This wraps the script (minus its single `export const meta`) as an
// AsyncFunction body, which permits top-level await/return and throws a
// SyntaxError on any real syntax problem — the correct equivalent of
// `node --check` for workflow scripts.
//
// Usage: node .claude/workflows/_wfcheck.mjs <file> [<file> ...]
import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node _wfcheck.mjs <file> [<file> ...]')
  process.exit(2)
}

let failed = false
for (const file of files) {
  const src = readFileSync(file, 'utf8').replace('export const meta', 'const meta')
  try {
    new AsyncFunction(src)
    console.log(`SYNTAX OK: ${file}`)
  } catch (e) {
    console.error(`SYNTAX ERROR: ${file} -> ${e.message}`)
    failed = true
  }
}
if (failed) { process.exit(1) }
