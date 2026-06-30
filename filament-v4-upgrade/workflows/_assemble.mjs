// .claude/workflows/_assemble.mjs
// Build tool for the Filament v4 upgrade workflows. Inlines _src/engine.mjs into
// each _src/*.template.mjs and writes the self-contained generated workflow files.
// Run from the repo root:  node .claude/workflows/_assemble.mjs  [--check]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, basename } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))     // .claude/workflows
const SRC = join(HERE, '_src')

export const BANNER =
  '// GENERATED from _src/engine.mjs by _assemble.mjs — DO NOT EDIT.\n' +
  '// Edit _src/engine.mjs or the matching _src/*.template.mjs, then run:\n' +
  '//   node .claude/workflows/_assemble.mjs\n'

export function extractEngineBody(engineSource) {
  const start = engineSource.indexOf('// <engine:start>')
  const end = engineSource.indexOf('// <engine:end>')
  if (start === -1 || end === -1 || end < start) {
    throw new Error('engine.mjs: missing or malformed // <engine:start> / // <engine:end> markers')
  }
  const body = engineSource.slice(start + '// <engine:start>'.length, end)
  // Strip leading `export ` from top-level declarations so the inlined body is plain.
  return body.replace(/^export\s+(const|let|function|class|async function)/gm, '$1').trim()
}

export function assembleOne(templateSource, engineBody, banner) {
  if (!templateSource.includes('// <engine:inline>')) {
    throw new Error('template missing // <engine:inline> marker')
  }
  const inlined = templateSource.replace('// <engine:inline>', engineBody)
  return banner + inlined + (inlined.endsWith('\n') ? '' : '\n')
}

function main() {
  const check = process.argv.includes('--check')
  const engineBody = extractEngineBody(readFileSync(join(SRC, 'engine.mjs'), 'utf8'))
  const templates = readdirSync(SRC).filter((f) => f.endsWith('.template.mjs'))
  const stale = []
  for (const t of templates) {
    const outName = basename(t).replace('.template.mjs', '.mjs')
    const outPath = join(HERE, outName)
    const assembled = assembleOne(readFileSync(join(SRC, t), 'utf8'), engineBody, BANNER)
    if (check) {
      let current = ''
      try { current = readFileSync(outPath, 'utf8') } catch { /* missing */ }
      if (current !== assembled) { stale.push(outName) }
    } else {
      writeFileSync(outPath, assembled)
      console.log(`assembled ${outName}`)
    }
  }
  if (check && stale.length) {
    console.error(`STALE (re-run _assemble.mjs): ${stale.join(', ')}`)
    process.exit(1)
  }
  if (check) { console.log('all generated workflows are up to date') }
}

// Only run as CLI, not when imported by tests.
if (process.argv[1] && process.argv[1].endsWith('_assemble.mjs')) { main() }
