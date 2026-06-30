// .claude/workflows/_src/__tests__/engine.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { severityRank, dedupe, routeForVerify, buildConfig } from '../engine.mjs'

const ENGINE_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../engine.mjs'),
  'utf8',
)

test('buildConfig applies defaults and overrides', () => {
  assert.equal(buildConfig().ddev, 'ddev')
  assert.equal(buildConfig({ ddev: '' }).ddev, '')
  assert.equal(buildConfig({ projectName: 'vlwpla' }).projectName, 'vlwpla')
})

test('severityRank orders severities', () => {
  assert.ok(severityRank('critical') > severityRank('low'))
  assert.equal(severityRank('nonsense'), 0)
})

test('dedupe merges by file+pattern+symbol and keeps max severity', () => {
  const out = dedupe([
    { dimension: 'a', findings: [{ id: '1', file: 'X.php', pattern: 'p', symbol: 's', severity: 'low', description: 'first' }] },
    { dimension: 'b', findings: [{ id: '2', file: 'x.php', pattern: 'P', symbol: 'S', severity: 'high', description: 'second' }] },
    { dimension: 'c', findings: [{ id: '3', file: 'Y.php', pattern: 'q', symbol: null, severity: 'medium', description: 'other' }] },
  ])
  assert.equal(out.length, 2)                                   // X.php collapsed
  const merged = out.find((f) => f.file === 'X.php')
  assert.equal(merged.severity, 'high')                         // max severity wins
  assert.ok(merged.description.includes('first') && merged.description.includes('second'))
})

test('dedupe promotes a fatal patternId when merging onto a null one', () => {
  const out = dedupe([
    { dimension: 'a', findings: [{ id: '1', file: 'X.php', pattern: 'p', symbol: 's', severity: 'low', description: 'first', patternId: null }] },
    { dimension: 'b', findings: [{ id: '2', file: 'x.php', pattern: 'P', symbol: 'S', severity: 'low', description: 'second', patternId: 'namespace-move' }] },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].patternId, 'namespace-move')
})

test('dedupe prefers a fatal patternId over an existing non-fatal one', () => {
  const out = dedupe([
    { dimension: 'a', findings: [{ id: '1', file: 'Y.php', pattern: 'q', symbol: null, severity: 'low', description: 'a', patternId: 'some-non-fatal' }] },
    { dimension: 'b', findings: [{ id: '2', file: 'y.php', pattern: 'Q', symbol: null, severity: 'low', description: 'b', patternId: 'richeditor-json-state' }] },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].patternId, 'richeditor-json-state')
})

test('routeForVerify sends medium+ and fatal-pattern findings to verify', () => {
  const { toVerify, notes } = routeForVerify([
    { id: '1', severity: 'low', patternId: null },              // -> notes
    { id: '2', severity: 'medium', patternId: null },           // -> verify (severity)
    { id: '3', severity: 'low', patternId: 'richeditor-json-state' }, // -> verify (fatal class)
    { id: '4', severity: 'info', patternId: 'unknown' },        // -> notes
  ])
  assert.deepEqual(toVerify.map((f) => f.id).sort(), ['2', '3'])
  assert.deepEqual(notes.map((f) => f.id).sort(), ['1', '4'])
})

test('engine.mjs carries ordered, non-empty knowledge slot markers', () => {
  for (const slot of ['knowledge', 'fatal', 'dimensions']) {
    const open = `// <${slot}:start>`
    const close = `// <${slot}:end>`
    const s = ENGINE_SRC.indexOf(open)
    const e = ENGINE_SRC.indexOf(close)
    assert.ok(s !== -1, `${open} present`)
    assert.ok(e !== -1, `${close} present`)
    assert.ok(e > s, `${close} comes after ${open}`)
    assert.ok(ENGINE_SRC.slice(s + open.length, e).trim().length > 0, `${slot} slot non-empty`)
  }
})
