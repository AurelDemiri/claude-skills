// GENERATED from _src/engine.mjs by _assemble.mjs — DO NOT EDIT.
// Edit _src/engine.mjs or the matching _src/*.template.mjs, then run:
//   node .claude/workflows/_assemble.mjs
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
function buildConfig(args) {
  const a = (args && typeof args === 'object') ? args : {}
  return Object.assign({
    projectName: 'pubmus',
    ddev: 'ddev',
    panelProviders: ['app/Providers/Filament/AdminPanelProvider.php'],
    filamentRoot: 'app/Filament',
    themeCss: ['resources/css/filament/admin/theme.css'],
    frontendCss: ['resources/css/app.css'],
    vendoredOverrides: ['app/Vendor/LaraZeus/Bolt'],
    testDir: 'tests/Feature/Filament',
    gate: {
      test: 'ddev php artisan test --compact',
      pint: 'ddev php vendor/bin/pint',
      analyse: 'ddev composer analyse',
      build: 'ddev yarn build',
      buildFallback: 'ddev npm run build',
    },
    guide: '.claude/workflows/filament-v4-upgrade-guide.md',
    packagePins: {},
    pintScope: 'tests/Feature/Filament app/Vendor',
    maxRepairRounds: 2,
    verifyReserveTokens: 50000,   // per-finding budget reserve before deferring to planner
  }, a)
}

function RULES(cfg) {
  return `
ENVIRONMENT & COMMAND RULES (CRITICAL):
- This is a ${cfg.ddev ? `DDEV project ("${cfg.projectName}", PHP 8.3); EVERY php/composer/artisan/test command MUST be prefixed with "${cfg.ddev}"` : 'standard PHP project'}. Never run bare php/composer/npm when a prefix is configured.
- Gate commands:
  * Tests (Pest):   ${cfg.gate.test}        (filter one: append --filter=Name)
  * Pint (format):  ${cfg.gate.pint}         (check-only: append --test ; scope: append a path)
  * PHPStan:        ${cfg.gate.analyse}
  * Frontend build: ${cfg.gate.build}        (fallback: ${cfg.gate.buildFallback})
- Pint MUST be scoped to "${cfg.pintScope}" — do NOT repo-wide reformat (preserve git blame).
- For Filament/Laravel v4 API questions, USE the Laravel Boost docs tool: run ToolSearch with query "select:mcp__laravel-boost__search-docs", then call it (auto-scoped to installed Filament v4 / Laravel 12 / Livewire 3). You may also read real source under vendor/filament to confirm signatures.
- Panel provider(s): ${cfg.panelProviders.join(', ')}. Filament code: ${cfg.filamentRoot}/**. Vendored overrides: ${cfg.vendoredOverrides.join(', ')}. Admin theme CSS: ${cfg.themeCss.join(', ')}. Tests: ${cfg.testDir}/**.
`
}

// <knowledge:start>
function KNOWLEDGE(cfg) {
  return `
KNOWN Filament v3->v4 breaking-change areas to hunt (only flag REAL occurrences in THIS repo):
1. Namespace consolidation: layout/schema components -> Filament\\Schemas\\Components (Grid, Section, Fieldset, Tabs, Wizard, Group); Get/Set -> Filament\\Schemas\\Components\\Utilities; ALL actions -> Filament\\Actions (NO Filament\\Tables\\Actions\\, Filament\\Forms\\Actions\\, Filament\\Notifications\\Actions\\). Impersonate action mirrors this.
2. Resource form/infolist signature: form(Form): Form -> form(Schema \$schema): Schema; infolist(Infolist): Infolist -> infolist(Schema \$schema): Schema.
3. Page/Resource static property types: navigationIcon "string|BackedEnum|null", navigationGroup "string|UnitEnum|null", view "protected string" (not static). Wrong types = fatal.
4. Table action lists: ->actions([]) -> ->recordActions([]); ->bulkActions([]) -> ->toolbarActions([]).
5. Action/closure params resolve by NAME not type in many spots.
6. Select::disableOptionWhen() value-based signature. 7. ->relationship() bound exactly once. 8. Placeholder removed in schemas -> TextEntry. 9. Layout components no longer full-width by default -> explicit ->columnSpan(Full). 10. RichEditor stores JSON (was HTML); render-side resolution + tiptap removal. 11. Removed/renamed x-filament:: blade components. 12. Nested-resource getUrl() parent params / {parent} binding / mountParentRecord(). 13. Hidden()+disabled() dehydrate to null (data loss). 14. Enum-options fields return enum INSTANCE via get(). 15. Relation-manager hydrate-auth 403. 16. Joined-table column sort (getJsonSafeColumnName). 17. Single-mode SelectFilter scalar default. 18. Empty-string vs null navigation group. 19. Moved auth translation keys. 20. ->label('') -> ->hiddenLabel(). 21. DatePicker inherits DateTimePicker::configureUsing() timezone shift; DateTimeStateCast asymmetry on live pickers. 22. Custom save-without-validation helpers must re-seed state. 23. Custom fields extending Schemas\\Components\\Component. 24. Cross-panel cluster breadcrumb route; topbar render-hook reordering. 25. Vendor-shadow override classes -> latent class.notFound when parent moved.
TAILWIND v4: single @import "tailwindcss"; @plugin "@tailwindcss/typography" (not config plugins array); @tailwindcss/vite plugin; no tailwind.config.js content globs (CSS-first); fi-* selector changes; @theme/oklch tokens. Verify ${cfg.themeCss.join(', ')} and front-end CSS compile and the build succeeds.
PACKAGES: bezhansalleh/filament-shield ^4, spatie/laravel-permission v7 (guard/team changes), impersonate, lara-zeus/bolt pin, filament spatie media-library & tags plugins ^4, ${cfg.projectName} internal statikbe/* leisure/archivable/printable family.

AUTHORITATIVE DETAIL: For the exact before->after of every pattern, precise API/blade/fi-* names, config keys, and the full 67-row gotcha catalog, READ ${cfg.guide} (its Phase sections + "Breaking-change patterns" + "Gotcha catalog"). Use its exact names verbatim — do NOT paraphrase API names.
`
}
// <knowledge:end>

// <fatal:start>
const FATAL_PATTERN_IDS = [
  'namespace-move', 'form-infolist-signature', 'static-property-types',
  'hidden-disabled-dehydrate', 'richeditor-json-state',
]
// <fatal:end>

// <dimensions:start>
const DIMENSIONS = [
  { key: 'forms-schemas', group: 'breaking', title: 'Forms & Schemas', focus: 'Resource form()/infolist() signatures (form(Schema $schema): Schema), Schemas Components namespaces (Grid/Section/Fieldset/Tabs/Wizard/Group), Get/Set utility namespaces, Placeholder->TextEntry, missing columnSpanFull/columnSpan, hidden()+disabled() dehydrate-to-null, enum-instance-via-get, save-without-validation helpers, custom fields extending Schemas Components Component.' },
  { key: 'tables', group: 'breaking', title: 'Tables', focus: '->actions([]) to ->recordActions([]), ->bulkActions([]) to ->toolbarActions([]), closure params resolving by name, Select::disableOptionWhen value-based signature, joined-table column sort (getJsonSafeColumnName), single-mode SelectFilter scalar default, table column namespaces.' },
  { key: 'infolists-views', group: 'breaking', title: 'Infolists & custom views', focus: 'Placeholder->TextEntry, removed/renamed blade components in infolist/custom views, custom badge/infolist views that should be native entries, TextEntry/IconEntry namespaces.' },
  { key: 'actions-namespaces', group: 'breaking', title: 'Action namespace consolidation', focus: 'Grep all of app/ for leftover Filament Tables/Forms/Notifications Actions or any non-consolidated Action import. ALL actions must be Filament\\Actions\\. Include impersonate action namespace.' },
  { key: 'pages-navigation-routing', group: 'breaking', title: 'Pages, navigation & routing', focus: 'navigationIcon/navigationGroup/view property type signatures (wrong types fatal), nested-resource getUrl() parent params, {parent} binding & mountParentRecord(), cross-panel cluster breadcrumb routes, empty-string vs null navigation group.' },
  { key: 'richeditor-contentblocks', group: 'breaking', title: 'RichEditor & content blocks', focus: 'RichEditor JSON-state migration (v4 stores JSON not HTML), render-side resolution, tiptap removal, content-block blade templates rendering rich text/HTML.' },
  { key: 'panel-auth-renderhooks', group: 'breaking', title: 'Panel provider, auth & render hooks', focus: 'Panel provider(s): render-hook reordering (topbar), moved auth translation keys / decoupled labels, ->label("") to ->hiddenLabel(), middleware, guest login redirect correctness, plugin registration.' },
  { key: 'datetime-pickers', group: 'breaking', title: 'Date/time pickers', focus: 'DatePicker inheriting DateTimePicker::configureUsing() timezone shift, DateTimeStateCast asymmetry on live pickers, global configureUsing for date pickers.' },
  { key: 'relation-managers', group: 'breaking', title: 'Relation managers', focus: 'Relation-manager hydrate-auth 403 (canViewForRecord/authorization), ->relationship() bound exactly once, Repeater ->schema() vs ->fields(), relation manager action namespaces.' },
  { key: 'vendored-bolt-overrides', group: 'breaking', title: 'Vendored shadow overrides', focus: 'Vendored override classes that extend vendor classes which may have moved in v4 (latent class.notFound / signature drift). Confirm parent classes still exist with matching signatures in vendor.' },
  { key: 'static-deprecations', group: 'breaking', title: 'Static analysis & deprecations', focus: 'Read phpstan.neon, then run analyse ONCE and report v4-related errors. Grep for deprecated Filament idioms / removed methods / v3-only signatures. (ONLY this agent may run analyse.)' },
  { key: 'tailwind-theme-css', group: 'tailwind', title: 'Tailwind v4 & theme CSS', focus: 'Theme + front-end CSS: single @import "tailwindcss", @plugin "@tailwindcss/typography", removed tailwind.config.js content globs, fi-* selector renames/removals, @tailwindcss/vite in vite.config.js, @theme/oklch tokens, whether custom fi-* overrides still match v4 DOM. Cross-check the build result.' },
  { key: 'packages', group: 'packages', title: 'Package compatibility', focus: 'filament-shield v4 config & policies, spatie/laravel-permission v7 (guard/team/cache), impersonate, lara-zeus/bolt pin (resolves + integrates), filament spatie media-library & tags plugins v4, statikbe/* leisure/archivable/printable forks. Read composer.json + composer.lock and config/*.php.' },
  { key: 'tests-observability', group: 'verify', title: 'Test & observability coverage gaps', focus: 'Review the test dir + Pest.php. Identify v4 risk areas with NO regression coverage. Identify whether a silent-403/forbidden observability net and a panel-crawl smoke test exist. Propose specific missing tests.' },
]
// <dimensions:end>

const INVENTORY_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    gateCommands: { type: 'object', additionalProperties: true, properties: {
      test: { type: 'string' }, pint: { type: 'string' }, analyse: { type: 'string' }, build: { type: 'string' },
    }, required: ['test', 'pint', 'analyse', 'build'] },
    buildVerified: { type: 'string', description: 'which build command actually succeeded, or why none did' },
    resources: { type: 'array', items: { type: 'object', additionalProperties: true, properties: {
      name: { type: 'string' }, file: { type: 'string' }, hasForm: { type: 'boolean' }, hasTable: { type: 'boolean' },
      hasInfolist: { type: 'boolean' }, relationManagers: { type: 'array', items: { type: 'string' } },
      pages: { type: 'array', items: { type: 'string' } },
    } } },
    pages: { type: 'array', items: { type: 'string' } },
    widgets: { type: 'array', items: { type: 'string' } },
    customFields: { type: 'array', items: { type: 'string' } },
    customPages: { type: 'array', items: { type: 'string' } },
    blocks: { type: 'array', items: { type: 'string' } },
    livewireComponents: { type: 'array', items: { type: 'string' } },
    themeCss: { type: 'array', items: { type: 'string' } },
    vendoredOverrides: { type: 'array', items: { type: 'string' } },
    contentBlockBlades: { type: 'array', items: { type: 'string' } },
    existingTests: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['gateCommands', 'resources', 'notes'],
}

const FINDINGS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    dimension: { type: 'string' },
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' },
      pattern: { type: 'string' },
      patternId: { type: ['string', 'null'] },
      severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
      file: { type: 'string' },
      line: { type: ['integer', 'null'] },
      symbol: { type: ['string', 'null'] },
      description: { type: 'string' },
      evidence: { type: 'string' },
      recommendedFix: { type: 'string' },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      verifyingTest: { type: ['string', 'null'] },
    }, required: ['id', 'pattern', 'severity', 'file', 'description', 'recommendedFix', 'confidence'] } },
  },
  required: ['dimension', 'summary', 'findings'],
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    isReal: { type: 'boolean' },
    verdict: { type: 'string', enum: ['confirmed', 'false-positive', 'already-fixed', 'needs-change'] },
    reasoning: { type: 'string' },
    severityAdjusted: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
    refinedFix: { type: 'string' },
    affectedFiles: { type: 'array', items: { type: 'string' } },
    testStrategy: { type: 'string' },
  },
  required: ['isReal', 'verdict', 'reasoning', 'refinedFix'],
}

const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    testsRan: { type: 'boolean' }, testsPassed: { type: ['integer', 'null'] }, testsFailed: { type: ['integer', 'null'] },
    testFailures: { type: 'array', items: { type: 'string' } },
    pintClean: { type: 'boolean' }, pintFindings: { type: 'array', items: { type: 'string' } },
    phpstanClean: { type: 'boolean' }, phpstanErrors: { type: 'array', items: { type: 'string' } },
    buildOk: { type: 'boolean' }, buildError: { type: ['string', 'null'] },
    crawlRan: { type: 'boolean' }, crawlPagesChecked: { type: ['integer', 'null'] },
    crawlFailures: { type: 'array', items: { type: 'string' } },
    green: { type: 'boolean', description: 'true only if tests pass, pint clean, phpstan clean, build ok, crawl clean' },
    summary: { type: 'string' },
  },
  required: ['testsRan', 'green', 'summary'],
}

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' },
      title: { type: 'string' },
      area: { type: 'string' },
      files: { type: 'array', items: { type: 'string' } },
      changeSummary: { type: 'string' },
      concreteSteps: { type: 'array', items: { type: 'string' } },
      risk: { type: 'string', enum: ['high', 'medium', 'low'] },
      test: { type: 'string' },
      dependsOn: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'title', 'files', 'changeSummary', 'concreteSteps', 'risk', 'test'] } },
    ordering: { type: 'array', items: { type: 'string' } },
    deferred: { type: 'array', items: { type: 'string' }, description: 'findings intentionally NOT fixed, with reason' },
    rationale: { type: 'string' },
  },
  required: ['items', 'ordering', 'rationale'],
}

const IMPL_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'skipped', 'failed'] },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testAddedOrUpdated: { type: ['string', 'null'] },
    targetedTestResult: { type: 'string' },
    pintRun: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['id', 'status', 'notes'],
}

function severityRank(s) { return ({ critical: 4, high: 3, medium: 2, low: 1, info: 0 })[s] ?? 0 }

function dedupe(findingsArrays) {
  const all = (findingsArrays || []).filter(Boolean)
    .flatMap((a) => (a.findings || []).map((f) => ({ ...f, dimension: a.dimension })))
  const seen = new Map()
  for (const f of all) {
    const key = `${(f.file || '').toLowerCase()}::${(f.pattern || '').toLowerCase()}::${(f.symbol || '').toLowerCase()}`
    if (!seen.has(key)) { seen.set(key, { ...f }) }
    else {
      const ex = seen.get(key)
      ex.description = `${ex.description}\n[also flagged by ${f.dimension}]: ${f.description}`
      if (severityRank(f.severity) > severityRank(ex.severity)) { ex.severity = f.severity }
      // Promote patternId so a fatal class survives the merge (keeps fatal-aware triage correct).
      if (f.patternId && (!ex.patternId || (!FATAL_PATTERN_IDS.includes(ex.patternId) && FATAL_PATTERN_IDS.includes(f.patternId)))) {
        ex.patternId = f.patternId
      }
    }
  }
  return Array.from(seen.values())
}

function routeForVerify(deduped) {
  const fatal = new Set(FATAL_PATTERN_IDS)
  const toVerify = [], notes = []
  for (const f of (deduped || [])) {
    if (severityRank(f.severity) >= 2 || fatal.has(f.patternId)) { toVerify.push(f) }
    else { notes.push(f) }
  }
  return { toVerify, notes }
}

// ---- agent-driven stages (reference workflow globals only inside bodies) ----

async function inventory(cfg) {
  // Port of filament-v4-polish.mjs:185-188, paths from cfg, build run once here.
  return agent(
    `${RULES(cfg)}\nMap the Filament surface area so downstream audit agents are well-targeted. READ-ONLY: no edits, no migrations.\n\nProduce a precise inventory:\n- Each Filament Resource under ${cfg.filamentRoot}/Resources/**: name, file, whether it defines form()/table()/infolist(), relation managers, Pages/* classes.\n- Standalone Pages, Widgets, custom Fields, custom Pages, Blocks under ${cfg.filamentRoot}/**.\n- Livewire components; admin theme CSS (${cfg.themeCss.join(', ')}) and front-end CSS entries (${cfg.frontendCss.join(', ')}); the vendored override tree(s) under ${cfg.vendoredOverrides.join(', ')} (list override classes); content-block blade templates that render rich text.\n- Existing Filament tests under ${cfg.testDir}/**.\n- Confirm the four gate commands run. ACTUALLY execute a cheap check for each: "${cfg.gate.pint} --version", confirm vendor/bin/phpstan exists, "${cfg.ddev} php artisan --version", and run "${cfg.gate.build}" ONCE reporting success (the only build run in this phase; capture errors verbatim into buildVerified). If it fails, try "${cfg.gate.buildFallback}" and report which worked.\n\nReturn the inventory object (gateCommands reflect the cfg commands that actually ran).`,
    { label: 'inventory', schema: INVENTORY_SCHEMA, effort: 'medium' },
  )
}

async function baselineGate(cfg, inv) {
  // Port of filament-v4-polish.mjs:216-219.
  return agent(
    `${RULES(cfg)}\nCapture the CURRENT baseline gate state (repo is mid-upgrade; failures are expected and informative). RUN, capturing real output:\n1. "${cfg.gate.test}" -> testsPassed/testsFailed + failing test names.\n2. "${cfg.gate.pint} --test ${cfg.pintScope}" -> pintClean + offending files.\n3. "${cfg.gate.analyse}" -> phpstanClean + error lines (truncate long ones).\n4. Skip build (inventory ran it); set buildOk from this note: ${inv?.buildVerified ?? 'unknown'}.\nDo NOT fix anything. crawlRan=false. green=false (baseline only). Return the gate object.`,
    { label: 'baseline-gate', phase: 'Audit', schema: GATE_SCHEMA, effort: 'low' },
  )
}

async function auditFanOut(cfg, inv, dims) {
  // Port of filament-v4-polish.mjs:221-224; require a patternId on each finding.
  const invJson = JSON.stringify(inv)
  return parallel(dims.map((d) => () => agent(
    `${RULES(cfg)}\n${KNOWLEDGE(cfg)}\nYou are the "${d.title}" audit specialist for an in-progress Filament v3->v4 upgrade. READ-ONLY: do NOT edit files, run tests, migrations, or the build. ${d.key === 'static-deprecations' ? `(EXCEPTION: you may run "${cfg.gate.analyse}" exactly once.)` : ''}\n\nINVENTORY:\n${invJson}\n\nYOUR FOCUS:\n${d.focus}\n\nMethod: read the relevant files thoroughly (grep/glob every occurrence), confirm v4 signatures via Boost search-docs or vendor/filament source, only report issues ACTUALLY present in this repo. Many areas are already migrated — report a clean dimension honestly with an empty findings array rather than inventing work. For each genuine issue: precise file+line, offending code as evidence, a concrete recommendedFix, confidence, and how to test it. Set patternId to the guide pattern id when it maps to a known breaking-change class (e.g. namespace-move, form-infolist-signature, static-property-types, hidden-disabled-dehydrate, richeditor-json-state), else null. Severity by runtime impact (critical=fatal/500/data-loss, high=broken feature, medium=incorrect/edge, low=style/deprecation, info=note).\n\nReturn the findings object for dimension "${d.key}".`,
    { label: `audit:${d.key}`, phase: 'Audit', schema: FINDINGS_SCHEMA, effort: 'medium' },
  )))
}

async function verifyFindings(cfg, toVerify) {
  // Port of filament-v4-polish.mjs:252-255; budget-cap the high-effort fan-out.
  const reserve = cfg.verifyReserveTokens
  const within = (typeof budget !== 'undefined' && budget && budget.total)
    ? toVerify.filter(() => budget.remaining() > reserve)
    : toVerify
  if (within.length < toVerify.length) {
    log(`Budget: verifying ${within.length}/${toVerify.length}; ${toVerify.length - within.length} deferred to planner as notes`)
  }
  const verified = await parallel(within.map((f) => () => agent(
    `${RULES(cfg)}\n${KNOWLEDGE(cfg)}\nYou are an adversarial verifier. A prior audit produced this finding for an in-progress Filament v4 upgrade. DEFAULT stance: skepticism — assume it may be a false positive or already fixed. READ-ONLY.\n\nFINDING:\n${JSON.stringify(f)}\n\nVerify against reality: open the file(s), read surrounding code, confirm v4 API via Boost search-docs or vendor/filament. Decide: "confirmed" (real -> isReal=true), "already-fixed" (isReal=false), "false-positive" (isReal=false), "needs-change" (real but fix wrong/incomplete -> isReal=true with corrected refinedFix). Provide refinedFix (exact change or "none"), affectedFiles, adjusted severity, a concrete testStrategy. Cite what you saw.`,
    { label: `verify:${f.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
  ).then((v) => (v ? { ...f, verdict: v } : null))))
  const deferred = toVerify.slice(within.length)
  return { confirmed: verified.filter(Boolean).filter((f) => f.verdict && f.verdict.isReal), deferred }
}

async function planFrom(cfg, confirmed, notes, baseline) {
  // Port of filament-v4-polish.mjs:264-267; ALWAYS include a panel-crawl-test work item.
  const plan = await agent(
    `${RULES(cfg)}\n${KNOWLEDGE(cfg)}\nYou are the planning lead. Turn confirmed findings into a concrete, ORDERED plan a sequential implementer executes one item at a time.\n\nCONFIRMED REAL FINDINGS (with verifier verdicts & refinedFix):\n${JSON.stringify(confirmed)}\n\nLOW/INFO/DEFERRED NOTES (decide which are worth doing; most can be deferred):\n${JSON.stringify(notes)}\n\nBASELINE GATE (resolve upgrade-related failures):\n${JSON.stringify(baseline)}\n\nRules:\n- Group related fixes into coherent, preferably file-disjoint work items; when an item must touch a shared file (panel provider, theme.css) put ALL its changes in ONE item.\n- Each item: concrete steps (no further decisions), exact files, risk, and a specific regression test under ${cfg.testDir}/** that proves the fix.\n- ALWAYS include one work item that creates/refreshes ${cfg.testDir}/PanelCrawlTest.php (the gate only RUNS it; you author it here). It must: create a super-admin (User factory + Shield super_admin role or all permissions), actingAs, mount every Resource List/Create page + one Edit page (seeded record) + every standalone Page + the dashboard via the livewire() helper asserting assertSuccessful(), and assert the guest login route redirects (not 403).\n- Order so foundational fixes (namespaces, signatures) precede dependents; use dependsOn; ordering in execution order.\n- List intentional deferrals in "deferred" with one-line reasons. Do NOT pad.\nReturn the plan object.`,
    { label: 'synthesize-plan', schema: PLAN_SCHEMA, effort: 'high' },
  )
  if (!plan || !Array.isArray(plan.items) || plan.items.length === 0) {
    log('PLAN GUARD: planner returned no items — entering repair/verify instead of silently doing nothing')
    return null
  }
  return plan
}

async function implementPlan(cfg, plan) {
  // Port of filament-v4-polish.mjs:273-286.
  const itemsById = new Map((plan.items || []).map((it) => [it.id, it]))
  const order = (plan.ordering && plan.ordering.length) ? plan.ordering : (plan.items || []).map((it) => it.id)
  const out = []
  for (const id of order) {
    const item = itemsById.get(id)
    if (!item) { continue }
    const r = await agent(
      `${RULES(cfg)}\n${KNOWLEDGE(cfg)}\nImplement ONE work item of a Filament v4 fix plan. Make ONLY this change — no unrelated refactors, no files outside the item. Preserve behavior except the documented fix. If after reading it is wrong or already done, set status=skipped and explain — do not force it.\n\nWORK ITEM:\n${JSON.stringify(item)}\n\nSteps:\n1. Read target file(s); confirm the change is still needed.\n2. Apply the fix exactly, matching surrounding conventions; confirm v4 API via Boost/vendor source if unsure.\n3. Add/extend the regression test ("${item.test}") under ${cfg.testDir}/** as a Pest test.\n4. Run ONLY that test: "${cfg.gate.test} --filter=<TestNameOrMethod>"; iterate to green (a few attempts); capture verbatim into targetedTestResult.\n5. Run "${cfg.gate.pint} <changed paths>" to format.\nReturn the impl result. Do NOT git commit.`,
      { label: `fix:${id}`, phase: 'Implement', schema: IMPL_SCHEMA, effort: 'high' },
    )
    if (r) { out.push(r) }
    log(`  fix ${id}: ${r && r.status ? r.status : 'no-result'}`)
  }
  return out
}

async function runGate(cfg, inv, label, extra) {
  // Port of filament-v4-polish.mjs:292-297, but the crawl test is AUTHORED in the plan;
  // the gate only RUNS it (and reports if it is missing rather than writing it).
  return agent(
    `${RULES(cfg)}\nYou are the verification gate. Run the FULL gate + panel crawl, capturing real output. ${extra || ''}\n\n1. "${cfg.gate.pint} ${cfg.pintScope}" (auto-fix), then "${cfg.gate.pint} --test ${cfg.pintScope}" to confirm clean.\n2. "${cfg.gate.analyse}" -> phpstanClean + remaining errors.\n3. "${cfg.gate.test}" -> testsPassed/testsFailed + failing names.\n4. "${cfg.gate.build}" (fallback "${cfg.gate.buildFallback}") -> buildOk + error.\n5. PANEL CRAWL: RUN the existing Pest test ${cfg.testDir}/PanelCrawlTest.php. If it is absent, set crawlRan=false and add "PanelCrawlTest.php missing" to crawlFailures (do NOT author it here — that is a plan work item). Record crawlPagesChecked + failures.\n\nSet green=true ONLY if tests pass AND pint clean AND phpstan clean AND build ok AND crawl ran with zero failures. INVENTORY: ${JSON.stringify(inv)}\nReturn the gate object with full detail.`,
    { label, schema: GATE_SCHEMA, effort: 'medium' },
  )
}

async function selfHeal(cfg, inv, plan, confirmedCount, gate) {
  // Port of filament-v4-polish.mjs:304-317.
  const rounds = []
  let g = gate, round = 0
  while (round < cfg.maxRepairRounds && g && g.green === false) {
    round++
    phase('Repair')
    const repair = await agent(
      `${RULES(cfg)}\n${KNOWLEDGE(cfg)}\nThe verification gate is RED. Fix ALL failures below so it goes green. Address each failing test, phpstan error, build error, panel-crawl failure: find the real cause (read code, check v4 docs/vendor source), apply a minimal correct fix, re-run the specific check. Do NOT delete or weaken tests to pass — fix the underlying code. If a failure is genuinely pre-existing and unrelated to the v4 upgrade, note it out-of-scope with a reason.\n\nGATE REPORT:\n${JSON.stringify(g)}\n\nCONTEXT:\n${JSON.stringify({ items: plan && plan.items, confirmedCount })}\n\nWhen done, run "${cfg.gate.pint} ${cfg.pintScope}". Return an impl result (id="repair-round-${round}"). Do NOT git commit.`,
      { label: `repair:${round}`, phase: 'Repair', schema: IMPL_SCHEMA, effort: 'high' },
    )
    rounds.push(repair)
    log(`Repair round ${round}: ${repair && repair.status ? repair.status : 'no-result'}`)
    g = await runGate(cfg, inv, `gate-after-repair-${round}`, 'A repair round just ran; re-verify everything from scratch.')
    log(`Re-gate after repair ${round}: green=${g && g.green}`)
  }
  return { gate: g, rounds }
}

async function commitPhase(cfg, name) {
  await agent(
    `${RULES(cfg)}\nThe "${name}" upgrade phase passed its gate. Stage and commit ONLY the changes for this phase. Run: git add -A && git commit -m "chore(filament-v4): ${name}". Do NOT push and do NOT open a PR. If there is nothing to commit, say so. Return a one-line summary.`,
    { label: `commit:${name}`, effort: 'low' },
  )
}

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
