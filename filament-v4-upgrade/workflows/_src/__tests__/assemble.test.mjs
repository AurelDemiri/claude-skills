// .claude/workflows/_src/__tests__/assemble.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractEngineBody, assembleOne, BANNER } from '../../_assemble.mjs'

test('extractEngineBody returns text between markers and strips export', () => {
  const src = [
    'const ignoredHeader = 1',
    '// <engine:start>',
    'export const A = 1',
    'export function f() { return 2 }',
    'const B = 3',
    '// <engine:end>',
    'const ignoredFooter = 4',
  ].join('\n')
  const body = extractEngineBody(src)
  assert.ok(!body.includes('ignoredHeader'))
  assert.ok(!body.includes('ignoredFooter'))
  assert.ok(body.includes('const A = 1'))          // export stripped
  assert.ok(body.includes('function f()'))          // export stripped
  assert.ok(!/^export /m.test(body))                // no leading export remains
})

test('assembleOne inlines body and prepends banner', () => {
  const tpl = ['export const meta = { name: "x" }', '// <engine:inline>', 'phase("Go")'].join('\n')
  const out = assembleOne(tpl, 'const A = 1', BANNER)
  assert.ok(out.startsWith(BANNER))
  assert.ok(out.indexOf('export const meta') < out.indexOf('const A = 1'))
  assert.ok(out.indexOf('const A = 1') < out.indexOf('phase("Go")'))
  assert.ok(!out.includes('// <engine:inline>'))
})
