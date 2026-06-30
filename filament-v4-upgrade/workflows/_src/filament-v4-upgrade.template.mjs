// .claude/workflows/_src/filament-v4-upgrade.template.mjs
export const meta = {
  name: 'filament-v4-upgrade-run',
  description: 'Full Filament v3->v4 + Tailwind v3->v4 upgrade: breaking changes, tailwind, package compat, verification — phase by phase, gated and committed. Assumes the bootstrap pre-flight (deps + filament-v4 rector) already ran in the main session.',
  phases: [
    { title: 'Inventory + Baseline', detail: 'map surface area + capture baseline gate' },
    { title: 'Breaking changes', detail: 'Filament v4 29-pattern catalog (11 core dimensions)' },
    { title: 'Tailwind v4', detail: 'entry CSS, @plugin typography, fi-* selectors, build' },
    { title: 'Package compat', detail: 're-add statikbe/* @ v4, Shield v4, permission v7, impersonate, leisure' },
    { title: 'Verification', detail: 'green gate + panel crawl + observability + regression' },
  ],
}
// <engine:inline>

const cfg = buildConfig(typeof args !== 'undefined' ? args : {})
const dimsByGroup = (g) => DIMENSIONS.filter((d) => d.group === g)

// One full cycle for a phase: audit subset -> verify -> plan -> implement -> gate -> self-heal -> commit.
async function runPhaseCycle(phaseName, dims, inv, baseline) {
  const audits = await auditFanOut(cfg, inv, dims)
  const { toVerify, notes } = routeForVerify(dedupe(audits))
  log(`${phaseName}: ${toVerify.length} to verify`)
  const { confirmed, deferred } = await verifyFindings(cfg, toVerify)
  const plan = await planFrom(cfg, confirmed, notes.concat(deferred), baseline)
  const impl = plan ? await implementPlan(cfg, plan) : []
  let gate = await runGate(cfg, inv, `gate:${phaseName}`, `This is the "${phaseName}" phase gate.`)
  const healed = await selfHeal(cfg, inv, plan, confirmed.length, gate)
  gate = healed.gate
  if (gate && gate.green) { await commitPhase(cfg, phaseName) }
  else { log(`${phaseName}: gate NOT green after ${cfg.maxRepairRounds} repair rounds — not committing`) }
  return { plan, impl, gate, confirmedCount: confirmed.length }
}

phase('Inventory + Baseline')
const inv = await inventory(cfg)
const baseline = await baselineGate(cfg, inv)
log(`Inventory: ${inv?.resources?.length ?? 0} resources; baseline tests ${baseline?.testsPassed ?? '?'}/${(baseline?.testsPassed ?? 0) + (baseline?.testsFailed ?? 0)}`)

phase('Breaking changes')
const breaking = await runPhaseCycle('breaking-changes', dimsByGroup('breaking'), inv, baseline)

phase('Tailwind v4')
const tailwind = await runPhaseCycle('tailwind-v4', dimsByGroup('tailwind'), inv, baseline)

phase('Package compat')
// statikbe/* were relaxed during the main-session pre-flight; the packages dimension re-adds + fixes them.
const packages = await runPhaseCycle('package-compat', dimsByGroup('packages'), inv, baseline)

phase('Verification')
const verify = await runPhaseCycle('verification', dimsByGroup('verify'), inv, baseline)
let finalGate = verify.gate
if (!finalGate || finalGate.green !== true) {
  finalGate = await runGate(cfg, inv, 'final-gate', 'Final whole-app verification across all phases.')
}

return {
  inventorySummary: inv && inv.notes,
  baseline,
  phases: {
    breaking: { committed: !!(breaking.gate && breaking.gate.green), confirmed: breaking.confirmedCount },
    tailwind: { committed: !!(tailwind.gate && tailwind.gate.green), confirmed: tailwind.confirmedCount },
    packages: { committed: !!(packages.gate && packages.gate.green), confirmed: packages.confirmedCount },
    verification: { committed: !!(verify.gate && verify.gate.green), confirmed: verify.confirmedCount },
  },
  finalGate,
  green: !!(finalGate && finalGate.green === true),
}
