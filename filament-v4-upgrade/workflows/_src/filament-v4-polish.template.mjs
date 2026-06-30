// .claude/workflows/_src/filament-v4-polish.template.mjs
export const meta = {
  name: 'filament-v4-polish',
  description: 'Autonomously audit, verify, fix and gate-verify a mostly-complete Filament v3->v4 upgrade',
  phases: [
    { title: 'Inventory', detail: 'map Filament surface area + confirm gate commands' },
    { title: 'Audit', detail: 'parallel deep audit across all dimensions + baseline gate' },
    { title: 'Verify', detail: 'adversarially verify each medium+/fatal-class finding' },
    { title: 'Plan', detail: 'synthesize a deduped, ordered, file-disjoint fix plan' },
    { title: 'Implement', detail: 'apply verified fixes sequentially, each with a regression test' },
    { title: 'Verify Gate', detail: 'full gate (tests/pint/phpstan/build) + panel crawl' },
    { title: 'Repair', detail: 'bounded self-heal if the gate is red' },
  ],
}
// <engine:inline>

const cfg = buildConfig(typeof args !== 'undefined' ? args : {})

phase('Inventory')
const inv = await inventory(cfg)
log(`Inventory: ${inv?.resources?.length ?? 0} resources, build = ${inv?.buildVerified ?? 'unknown'}`)

phase('Audit')
const baselinePromise = baselineGate(cfg, inv)
const audits = await auditFanOut(cfg, inv, DIMENSIONS)        // polish = all dimensions
const baseline = await baselinePromise
log(`Baseline: ${baseline?.testsPassed ?? '?'} passed / ${baseline?.testsFailed ?? '?'} failed`)
const deduped = dedupe(audits)
const { toVerify, notes } = routeForVerify(deduped)
log(`Audit: ${deduped.length} deduped -> ${toVerify.length} to verify`)

phase('Verify')
const { confirmed, deferred } = await verifyFindings(cfg, toVerify)
const allNotes = notes.concat(deferred)
log(`Verify: ${confirmed.length} confirmed real; ${allNotes.length} notes`)

phase('Plan')
const plan = await planFrom(cfg, confirmed, allNotes, baseline)

phase('Implement')
const implResults = plan ? await implementPlan(cfg, plan) : []

phase('Verify Gate')
let gate = await runGate(cfg, inv, 'gate', '')
log(`Full gate: green=${gate && gate.green}`)
const healed = await selfHeal(cfg, inv, plan, confirmed.length, gate)
gate = healed.gate

return {
  inventorySummary: inv && inv.notes,
  baseline,
  dedupedFindingCount: deduped.length,
  confirmedFindings: confirmed.map((f) => ({ id: f.id, file: f.file, pattern: f.pattern, severity: (f.verdict && f.verdict.severityAdjusted) || f.severity, fix: f.verdict && f.verdict.refinedFix })),
  noteCount: allNotes.length,
  plan,
  implementation: implResults,
  repairRounds: healed.rounds,
  finalGate: gate,
  green: !!(gate && gate.green === true),
}
