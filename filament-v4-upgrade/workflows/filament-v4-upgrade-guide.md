# Filament v3 -> v4 Upgrade Guide (generic, Statik-flavored)

> **Provenance:** Generated from the mined commit history of a real, completed Filament v3 -> v4
> upgrade on a Statik-shaped Laravel application. Every pattern, gotcha, and matrix row below is
> evidence-based (distilled from individual commit knowledge-cards), then generalized: project keys,
> model names, and domain language are stripped, but framework API names, blade component names,
> `fi-*` CSS selectors, config keys, and package names are kept verbatim because they are
> load-bearing.

## When to use / scope

Use this guide to drive a **Filament v3.x -> v4.x** upgrade on a repository that looks like a Statik
Laravel project:

- **Laravel 12 / PHP 8.3**, Filament v3 panel(s) (often more than one: admin + tenant portal +
  account/onboarding + a website/CMS panel).
- `bezhansalleh/filament-shield` v3 for permission generation, layered on
  `spatie/laravel-permission` v6 (frequently with **teams** enabled for multi-tenancy).
- One or more **`statikbe/*` first-party Filament packages** (the leisure family
  `laravel-leisure` + `laravel-filament-leisure`, `filament-archivable`, `filament-printable`,
  the flexible-content-blocks family `laravel-filament-flexible-content-blocks` +
  `-flexible-content-block-pages` + `-flexible-blocks-asset-manager`,
  `laravel-filament-chained-translation-manager`, `laravel-chained-translator`).
- Third-party plugins: `stechstudio/filament-impersonate`, `ysfkaya/filament-phone-input`,
  `pxlrbt/filament-environment-indicator`, `schmeits/filament-character-counter`,
  `awcodes/filament-tiptap-editor`, `okeonline/filament-archivable`, `arielmejiadev/filament-printable`.
- **DDEV** for local tooling (`ddev php`, `ddev composer`, `ddev yarn`), **Pint** for style,
  **Pest** for tests, a **custom Tailwind theme** under `resources/css/filament/<panel>/`.

Out of scope: Filament v5, Laravel 13, a PHP major bump, and Livewire v4 (several packages refuse to
move to Livewire 4, so keep Livewire on v3).

This is a large, multi-day upgrade with a long tail of small runtime fixes. Do it on a dedicated
branch with a green baseline. The dependency bump is one keystone commit; the rest is fallout.

---

## Pre-flight: package compatibility matrix

Audit the target's `composer.json`, `composer.lock`, `package.json`, and `repositories[]` against
this matrix before touching anything. Flag any Filament-ecosystem package present in the repo but
absent here, and any matrix package missing from the repo.

| Package | v3 state | v4 target / action | Notes |
|---|---|---|---|
| `filament/filament` | `^3.2` | **bump** `^4.0` | Keystone. Composer won't resolve until every plugin moves too. |
| `filament/spatie-laravel-media-library-plugin` | `^3.2` | **bump** `^4.0` | Media relation managers usually fall through to `Response::allow()` (no policy). |
| `filament/spatie-laravel-translatable-plugin` | `^3.2` | **replace** -> `lara-zeus/spatie-translatable: ^1.0` | No v4 release. Swap the panel plugin class (Pattern 1). Do NOT jump to `lara-zeus/spatie-translatable ^2` (requires Filament v5). |
| `filament/upgrade` | (absent) | **add** dev dep `^4.0` | Run its rector pass first; handles the bulk of namespace moves. |
| `bezhansalleh/filament-shield` | `^3.2` | **bump** `^4.0` | Config is rewritten, not just bumped; permission KEY format changes (Phase 4). |
| `spatie/laravel-permission` | `^6.x` | **bump** `^7.0` | Dragged in by Shield v4. New `config/permission.php` keys. |
| `stechstudio/filament-impersonate` | `^3.13` | **bump** `^4.0` (then `^5.0`) | v4 = action namespace move; v5 = events/trait API change. |
| `ysfkaya/filament-phone-input` | `^3.2` | **bump** `^4.0` | Refreshes published vendor CSS. |
| `pxlrbt/filament-environment-indicator` | `^2.0` | **bump** `^3.0` | Published CSS tweak (`.fi-sidebar-nav > .environment-indicator`). |
| `schmeits/filament-character-counter` | `^1.3` | **bump** `^5.0` | Large internal major; verify changelog. |
| `awcodes/filament-tiptap-editor` | `^3.x` | **remove** | Incompatible with v4. Migrate to the built-in `RichEditor` (Pattern 10). |
| `okeonline/filament-archivable` | `dev-laravel-12` | **remove** -> model trait `joelbutcher/laravel-archivable: ^1.0`; UI re-added as `statikbe/filament-archivable` fork | Two halves: the model `Archivable` trait, and the Filament UI actions/filter (Phase 4). |
| `arielmejiadev/filament-printable` | `^3.0` | **remove** -> re-add `statikbe/filament-printable` fork | No upstream v4; Statik fork on a `dev-filament-v4` branch then a tagged release. |
| `statikbe/laravel-leisure` | path/`@dev` | **fork/bump** v4 tags | Leisure model base classes; pin once tagged. |
| `statikbe/laravel-filament-leisure` | path/`@dev` | **fork/bump** `^4.1` | Leisure Filament resources; `columnSpanFull()` patches land package-side. |
| `statikbe/filament-archivable` | (new) | **add** fork `dev-filament-v4` -> tag | `Statik\FilamentArchivable\*`. Provides `ArchiveAction`, `UnArchiveAction`, `ArchivedFilter`, dimmed-row styling. |
| `statikbe/filament-printable` | (new) | **add** fork `dev-filament-v4` -> tag | `Statik\FilamentPrintable\Actions\PrintAction` (uses `actionJs()`). Avoid `"` in injected JS literals. |
| `statikbe/laravel-filament-flexible-content-blocks` | `^3.0` | **fork/bump** `@dev` / `dev-... as 4.99.99` -> `^4.0` | Drops `FlexibleRichEditorField` + `RichEditorConfigurator`; migrate to built-in RichEditor. |
| `statikbe/laravel-filament-flexible-content-block-pages` | `^3.0` | **fork/bump** `^4.0` (then a fallback-route fix branch) | CMS catch-all can shadow panel URLs after Filament 4.11.2 (Gotcha catalog). |
| `statikbe/laravel-filament-flexible-blocks-asset-manager` | `^3.0` | **bump** `^4.0` | Pin once tagged. |
| `statikbe/laravel-filament-chained-translation-manager` | `^3.3` | **bump** `^4.0` | Pin once tagged. |
| `statikbe/laravel-chained-translator` | path/`@dev` | **fork/bump** v4 | Travels with the chained-translation-manager. |
| `livewire/livewire` | `^3` | **keep** `^3` | Do NOT move to v4 (breaks several packages). |
| `tailwindcss` | `^3` | **bump** `^4` | Tailwind v4 migration (Phase 3). |
| `@tailwindcss/vite` | (absent) | **add** `^4` | Replaces the postcss Tailwind plugin. |
| `@tailwindcss/typography` | bundled | **add** explicit `^0.5` + `@plugin` | No longer auto-loaded; `prose` is dead without it. |
| `@tailwindcss/forms` / `aspect-ratio` | npm plugins | **move to CSS** `@plugin '...'` | Loaded via `@plugin` at-rules, not `tailwind.config.js`. |
| `postcss` / `autoprefixer` | deps | **remove** | Tailwind v4 handles this; reset `postcss.config.js` plugins to `{}`. |
| `tailwindcss/nesting` (`postcss-nesting`) | postcss plugin | **remove** | Tailwind v4 has native nesting. |
| `prettier-plugin-tailwindcss` | `^0.6` | **bump** `^0.7` | Pre-1.0, breaking-by-convention. |
| `vite` | `^6` | **bump** `^8` (skip 7) | Dragged in; new tree-shaking breaks unused asset globs (Phase 1). |
| `laravel-vite-plugin` | `^1` | **bump** `^3` (skip 2) | Moves with Vite. |

Statik-specific reminders for the audit phase:

- A `composer.local.json` is the **developer-only path-fork overlay**. The committed `composer.lock`
  must be regenerated **without** it (`composer ... --no-plugins`) so CI installs clean
  VCS-resolved packages, never `"dist": {"type": "path"}` entries.
- `minimum-stability: dev` + `prefer-stable: true` are required for `@dev` / branch constraints to
  resolve while statikbe forks are mid-flight.
- Use `ddev php` / `ddev composer` / `ddev yarn`; bare `yarn` hits rolldown native-binding errors,
  bare `phpstan` fails outside DDEV.

### Tooling to leverage (detect availability first)

Before starting, detect which of these are available and lean on them — they materially speed up and
de-risk the upgrade. Record what is present in the audit output so the later phases use it.

- **`filament/blueprint`** — Filament v4 planning tool. Check `composer show filament/blueprint` (or
  `require-dev` in `composer.json`). If present, use it to write the v4 migration plan; it reads
  `vendor/filament/blueprint/resources/markdown/planning/overview.md` for the plan format. It is
  v4-specific and **can only be installed once `filament/filament` is already on v4** — so it is normal
  for the Phase 1 dependency bump plus blueprint to have been applied by hand as a bootstrap *before*
  this workflow runs. On such a **partially-completed upgrade**, detect the already-applied work from the
  audit and verify it rather than re-running Phase 1 from a v3 baseline. If absent and you want structured
  plans, add it once you are on v4: `ddev composer require --dev filament/blueprint`.
- **Laravel Boost** (`laravel/boost`, an MCP server) — check `composer show laravel/boost` and whether
  the `laravel-boost` MCP is connected. If available:
  - `search-docs` returns **version-specific** Filament v4 / Laravel 12 docs — query it before each
    breaking-change pattern instead of guessing at v4 API shapes.
  - `database-schema` / `database-query` to inspect the Shield `roles`/`permissions` tables and the
    stored permission-key format **before** re-seeding (Phase 4).
  - `browser-logs` to read panel JS errors and exceptions during the Phase 5 crawl.
- **Browser-automation MCP — Playwright MCP or Chrome DevTools MCP** — check whether either is
  connected. Use it to drive the **Phase 5 panel crawl** (navigate every route as super_admin, capture
  HTTP status + console + network) which is otherwise tedious and easy to under-cover. Chrome DevTools
  MCP additionally gives console/network inspection and `take_snapshot`; Playwright gives scripted
  multi-page navigation.
- **PhpStorm MCP** (only if the project is open and indexed) — check the `phpstorm` MCP. Use:
  - `get_inspections` / `get_file_problems` (+ `apply_quick_fix`) for a fast per-file correctness check
    after each namespace-move edit, instead of a full PHPStan run every time.
  - `search_symbol` / `get_symbol_info` to resolve where a moved v4 class now lives (grep can't follow
    DI / traits / interfaces).
  - `search_structural` for mechanical refactor sweeps (e.g. every `->actions([` → `->recordActions([`).
- **Gate tooling — install it if the repo lacks it (standing permission in an automated run).** The shared
  verification gate assumes a test framework, Pint, and PHPStan/Larastan. If any is missing, do not skip
  the gate — install and wire it:
  - **Tests:** install **Pest** (`pestphp/pest` + `pestphp/pest-plugin-livewire`). **Statik prefers Pest
    over PHPUnit** — install Pest rather than falling back to PHPUnit, and recreate the test config if a
    prior cleanup removed it. (Honor a target repo's own CLAUDE.md if it explicitly mandates PHPUnit.)
  - **Lint:** `ddev composer require --dev laravel/pint` (+ a `pint.json` with the Laravel preset).
  - **Static analysis:** `ddev composer require --dev larastan/larastan`, add `phpstan.neon` (Larastan
    extension, level 5 over `app`/`bootstrap`/`config`/`database`/`routes`) and an `analyse` composer
    script, then baseline the pre-existing findings (`phpstan-baseline.neon`) so the gate is green and
    only NEW code is checked. **This is the single highest-leverage check for a v4 upgrade** — it catches
    the class/namespace moves (a relocated vendor class, a model that became an enum) that a clean boot
    and panel crawl silently miss.

Fallbacks if none of the MCP tooling is present: `ddev php artisan filament:upgrade` (rector) for the
namespace bulk-moves, `ddev composer analyse` (PHPStan) for correctness, and a scripted HTTP crawl
(`ddev php artisan test` smoke tests / curl) for Phase 5.

---

## Phase 1 - Dependencies

1. **Add `filament/upgrade` (dev) and run its rector pass first:** `ddev php artisan filament:upgrade`.
   It handles most namespace moves. Auth pages/responses, layout `Component`, plugin classes, and the
   patterns in Phase 2 still need manual fixes.
2. **Edit `composer.json` per the matrix.** Composer will refuse to resolve `filament/filament: ^4.0`
   until **every** dependent plugin is bumped in the same change. That is expected; bump them together.
3. **statikbe forks with no v4 tag yet:** point them at their v4 branches and add `repositories[]`
   VCS entries. Use a `"dev-<branch> as 4.99.99"` alias where a downstream `^4` constraint demands a
   satisfying version (e.g. `"dev-feature/filament-v4-upgrade as 4.99.99"`). As real v4 tags land,
   replace the dev/branch constraints with semver (`^4.0`, later `^4.1`) and re-lock.
4. **Rebuild the lock and re-vendor assets.** `ddev composer update -W`, then
   `ddev php artisan filament:upgrade` to re-publish Filament's compiled `public/css/filament/**` and
   `public/js/filament/**` (this runs automatically as a `post-autoload-dump` script, but commit the
   churn). Keep the regenerated assets in a **separate, source-free** "refresh published assets"
   commit so the real diff stays reviewable. Re-run `filament:upgrade` after *any* later lock change
   that re-resolves a Filament package.
5. **CI-safe lock:** regenerate without the path-fork overlay so CI can install:
   `composer update statikbe/* --no-plugins`. Verify lock entries resolve from GitHub VCS, not local
   path repos.
6. **Vite asset-glob manifest fix (side effect of the Vite/laravel-vite-plugin bumps):** an unused
   `import.meta.glob([...])` is tree-shaken by the new Vite, so static assets referenced via
   `Vite::asset(...)` vanish from the manifest. Force eager URL resolution:

   ```diff
    import.meta.glob([
        '../img/**',
        '../fonts/**',
        '../icons/**',
   -]);
   +], { eager: true, query: '?url', import: 'default' });
   ```
7. **Wire the verification gate early.** If the audit found the test framework, Pint, or PHPStan/Larastan
   missing, install and configure them now (see **Gate tooling** above) so Phases 2-5 can actually gate on
   them. Don't defer this — a missing static-analysis gate is how latent v4 class/namespace breakage slips
   through to the end.

After Phase 1, composer must resolve and the lock must be CI-safe. Tests/build may still fail on
breaking changes handled in Phases 2-4.

---

## Phase 2 - Filament v4 breaking changes (pattern catalog)

Work through each pattern against the inventory from the pre-flight audit. Use the exact API names,
blade component names, and config keys below. Add or update a Pest regression test for each fix.

### Pattern 1 - Namespace consolidation (Auth / Schemas / Actions)

v4 moves and consolidates namespaces. The `filament/upgrade` rector pass covers most; the stragglers:

```diff
-use Filament\Pages\Auth\Register as BaseRegister;
+use Filament\Auth\Pages\Register;
-use Filament\Http\Responses\Auth\Contracts\RegistrationResponse;
+use Filament\Auth\Http\Responses\Contracts\RegistrationResponse;
-use Filament\SpatieLaravelTranslatablePlugin;
+use LaraZeus\SpatieTranslatable\SpatieTranslatablePlugin;

# layout/schema components move to Filament\Schemas\Components
-use Filament\Forms\Components\Component;        // layout component base
+use Filament\Schemas\Components\Component;
-use Filament\Resources\Components\Tab;
+use Filament\Schemas\Components\Tabs\Tab;
-use Filament\Forms\Components\Section;           // and Grid, Tabs, Fieldset
+use Filament\Schemas\Components\Section;
+use Filament\Schemas\Components\Flex as Split;   // v4 has no Split; Flex replaces it

# ALL actions consolidate under Filament\Actions (no Tables\/Forms\/Notifications\ sub-namespaces)
-use Filament\Tables\Actions\EditAction;
+use Filament\Actions\EditAction;
-\Filament\Notifications\Actions\Action::make(...)   // notification action is the same Action class
+Action::make(...)

# impersonate mirrors the action consolidation
-use STS\FilamentImpersonate\Tables\Actions\Impersonate;   // (v4)
-use STS\FilamentImpersonate\Pages\Actions\Impersonate;    // (older)
+use STS\FilamentImpersonate\Actions\Impersonate;
```

**Namespace split is the common mistake:** layout components (`Section`, `Grid`, `Tabs`, `Tab`,
`Fieldset`, `Flex`) live under `Filament\Schemas\Components\*`. **Form input fields** (`TextInput`,
`Select`, `Repeater`, `DatePicker`, `Placeholder`) **stay** under `Filament\Forms\Components\*`. A
careless rector sweep wrongly relocates the inputs into `Schemas\Components` -> class-not-found. Grep
for `Filament\Tables\Actions\`, `Filament\Forms\Actions\`, `Filament\Notifications\Actions\` to catch
all action stragglers.

### Pattern 2 - `form(Form): Form` -> `form(Schema $schema): Schema`

v4 unifies forms and infolists onto `Filament\Schemas\Schema`. Update the signature **and** every
reference to the old `$form` / `$infolist` variable in the body (including delegating wrappers in
relation managers, widgets, and `ViewAction::make()->schema(fn (Schema $schema) => ...)` closures).

```diff
-use Filament\Forms\Form;
+use Filament\Schemas\Schema;

-public static function form(Form $form): Form
+public static function form(Schema $schema): Schema
 {
-    return $form->schema([ /* ... */ ]);
+    return $schema->schema([ /* ... */ ]);
 }

-public static function infolist(Infolist $infolist): Infolist
+public static function infolist(Schema $schema): Schema
 {
-    $record = $infolist->getRecord()->load(...);
+    $record = $schema->getRecord()->load(...);
     return $schema->record($record)->...;
 }
```

Rule of thumb: any `form()`/`infolist()` body that still names `$form` or `$infolist` is a leftover.
Custom pages: override `form(Schema $schema): Schema` returning `$schema->components([...])` instead
of the v3 `getForms()` + `makeForm()->schema()->statePath('data')` pattern (the schema is passed in
pre-configured with the right state path). Auth `Register` pages that injected a default `name` field
should `unset($data['name'])` in `mutateFormDataBeforeRegister()` if the user model uses
`first_name`/`last_name`. v4 also **removed** the `protected function getForms(): array` registration:
just define public `name(Schema $schema): Schema` methods; they are auto-discovered. Fix
`@property Form $form` docblocks to `@property Schema $form`.

### Pattern 3 - `$navigationIcon` / `$navigationGroup` property types

```diff
-protected static ?string $navigationIcon = 'heroicon-o-newspaper';
+protected static BackedEnum|string|null $navigationIcon = 'heroicon-o-newspaper';
```

`$navigationGroup` is `string|UnitEnum|null`. Preserve these union types when overriding `Page`,
`Resource`, `Widget` properties (also: `$view` is `protected string`, not `protected static string`).

### Pattern 4 - Table action lists: `->actions([` -> `->recordActions([`

```diff
         ->table(...)
-            ->actions([
+            ->recordActions([
                 ViewAction::make(),
                 EditAction::make(),
             ]);
```

### Pattern 5 - Action closures resolve params by NAME, not type

Outside a Schema context, v4 has no closure-DI handler for typed `BulkAction $bulkAction`,
`Set $set`, or `Get $get` parameters on an Action `->action()` closure. A typehinted param falls
through to the container, throws `BindingResolutionException`, and Filament **swallows** it -> the
button silently does nothing.

```diff
 BulkAction::make('approve')
-    ->action(function (BulkAction $bulkAction, Collection $records) {
+    ->action(function (Collection $records) {
         // ... resolve $set/$get by name (untyped) if needed:
     });
```

Resolve `$set` / `$get` by parameter **name** (untyped, or PHPDoc-only `/** @var Set $set */`).
Schema *field* closures still resolve `Set`/`Get` by type; Actions do not. When the broken typehint
is in **vendor** code you can't edit, subclass the action and re-bind `->action()` with a
name-based parameter, then point your local resource at the subclass. While you're here, replace any
silent `return` on an empty/ineligible selection with a `Notification::make()->danger()->...->send()`.

### Pattern 6 - `Select::disableOptionWhen()` value-based signature

The closure now receives the scalar option `$value` (the key), not the hydrated model.

```diff
 Select::make('some_field')->relationship('rel', 'name')
-    ->disableOptionWhen(fn (SomeModel $option) => $option->isArchived())
+    ->disableOptionWhen(fn (string $value): bool => SomeModel::withArchived()->find($value)?->isArchived() ?? false)
```

Re-resolve the record from `$value` inside the closure when you need model state. Assert with
`assertFormFieldExists('field', checkFieldUsing: fn (Select $f) => $f->isOptionDisabled($key, $label))`.

### Pattern 7 - Bind `->relationship()` exactly once

Calling `Select::relationship(...)` a **second** time re-sets the field's option wiring, silently
overwriting a `getOptionLabelUsing` resolver installed by a base class (-> options show raw ids). A
subclass that re-calls `->relationship()` just to add `modifyQueryUsing` must instead **forward** the
closure through the single base-class `->relationship(..., modifyQueryUsing: $closure)` call.

### Pattern 8 - `Placeholder` -> `TextEntry`

`Filament\Forms\Components\Placeholder` is deprecated. Read-only "display a value/HTML" usages move to
`Filament\Infolists\Components\TextEntry`; `->content(...)` maps 1:1 to `->state(...)`.

```diff
-use Filament\Forms\Components\Placeholder;
+use Filament\Infolists\Components\TextEntry;

-Placeholder::make('x')->content(fn (?M $r): string => $r?->x ?? '-');
+TextEntry::make('x')->state(fn (?M $r): string => $r?->x ?? '-');
```

`HtmlString` returned from `->state()` still renders as HTML. Keep `->dehydrated(false)` for a
UI-only entry. (Note: an intermediate migration sweep may temporarily land `Placeholder` under
`Filament\Schemas\Components\` before this `TextEntry` swap; the `TextEntry` move is the durable fix.)

### Pattern 9 - Restore default `columnSpanFull()` on layout components

v4 stopped defaulting `Section`/`Grid`/`Fieldset` to full width; nested layout components collapse to
one column. Restore the v3 behavior once, centrally, instead of editing every call site:

```diff
+use Filament\Schemas\Components\Fieldset;
+use Filament\Schemas\Components\Grid;
+use Filament\Schemas\Components\Section;
+// in a service provider boot():
+Section::configureUsing(fn (Section $s) => $s->columnSpanFull());
+Grid::configureUsing(fn (Grid $g) => $g->columnSpanFull());
+Fieldset::configureUsing(fn (Fieldset $f) => $f->columnSpanFull());
```

`configureUsing` runs at `make()` time, so call sites can still narrow with `->columnSpan(N)`.

### Pattern 10 - `RichEditor`: JSON state + render-side resolution + migrating off tiptap

v4's built-in `RichEditor` stores **ProseMirror JSON** (an array), not an HTML string, and inline
images are stored by reference (`<img data-id="...">`). This breaks code in several places:

- **String inspection of the value** (e.g. a custom rule calling `str_contains($value, ...)`) crashes
  with `TypeError` because `$value` is an array. Convert first:

  ```diff
  +use Filament\Forms\Components\RichEditor\RichContentRenderer;
   ->rules([fn () => function ($attribute, $value, $fail) {
  +    if (blank($value)) { return; }
  +    $html = is_array($value) ? RichContentRenderer::make($value)->toHtml() : (string) $value;
  -    if (! str_contains($value, '[some_tag]')) {
  +    if (! str_contains($html, '[some_tag]')) {
           $fail(__('some.tag_required'));
       }
   }])
  ```

  Keep the `is_array()` / `(string)` fallback so legacy HTML-string records still validate.

- **Read-side rendering** must go through `RichContentRenderer`, never raw `{!! $html !!}` (the
  `data-id` placeholders won't resolve to real `src` URLs otherwise). Centralize in one partial and
  `@include` it; wrap output in `fi-prose` (v4 typography keys off `fi-prose`, not plain `prose`):

  ```diff
  -<div class="fi-prose">{!! $record->some_field ?? '-' !!}</div>
  +<div class="fi-prose canBeRichEditorTable">
  +    {!! \Filament\Forms\Components\RichEditor\RichContentRenderer::make($record->some_field ?? '')->toHtml() !!}
  +</div>
  ```

  In infolists, replace `TextEntry->html()` with a `ViewEntry->view('...rich-editor-content', [...])`
  that renders through the renderer. **Render-then-sanitize ordering:** when output is still passed
  through an HTML sanitizer, render first, then sanitize:
  `Sanitizer::sanitizeHtml(RichContentRenderer::make($html)->toHtml())`.

- **Attachment disk/directory/visibility at render time must match what was written at edit time.**
  Filament defaults attachment visibility to `private`; set `->fileAttachmentsVisibility('public')`
  (and a matching `'public'` disk in the package/app config) or front-end images 404.

- **Migrating off `awcodes/filament-tiptap-editor`:** swap `TiptapEditor::make()` for
  `RichEditor::make()` and translate the old profile tool names to v4 toolbar button names via a map:
  `heading -> ['h2','h3']`, `bullet-list -> bulletList`, `ordered-list -> orderedList`,
  `hr -> horizontalRule`, `media -> attachFiles`, `align-left/center/right -> alignLeft/Center/Right`,
  plus `bold/italic/strike/underline/superscript/subscript/link/table/blockquote` 1:1. When a mapping
  value can be a single button or an array, flatten on use (`array_push($mapped, ...(array) $value)`).
  There is no equivalent for tiptap `lead`/`small` -> drop them. The `tiptap_converter()->asHTML()`
  helper is gone once the package is removed: fall back to `strip_tags($content)` for string input
  (return `''` otherwise). Delete `config/filament-tiptap-editor.php`, the tiptap npm deps, the vite
  input entry, and the `FilamentAsset::register(Js::make('tiptap-...'))` registration.

- **Apply cross-cutting RichEditor config/rules globally** via `RichEditor::configureUsing()` in a
  service provider, so editors created **inside packages** (content blocks) also get them:

  ```php
  RichEditor::configureUsing(function (RichEditor $editor) {
      $editor->rules([new NoAdminLinks])
          ->fileAttachmentsDisk('public')
          ->fileAttachmentsDirectory('rich-editor-attachments')
          ->fileAttachmentsVisibility('public')
          ->fileAttachmentsAcceptedFileTypes(['image/jpeg', 'image/png', 'image/webp'])
          ->fileAttachmentsMaxSize(4096);
  });
  ```

- For RichEditors whose **read side can't carry table/attachment styling** (newsletter/email blocks),
  drop those toolbar buttons: `->disableToolbarButtons(['attachFiles', 'table'])`.

### Pattern 11 - Removed blade components

Several v3 blade components/sub-components are gone. Custom views referencing them throw at
**view-compile** time -> `view:cache` fails on deploy even if never rendered at runtime. Grep
`resources/views` for `x-filament-forms::`, `x-filament-tables::`, `x-filament-panels::`,
`x-filament-infolists::` after the bump.

| Removed | Replacement |
|---|---|
| `<x-filament-panels::form wire:submit>` (with submit button) | `<form wire:submit="..." class="fi-sc-form grid gap-y-6">` + `<x-filament::actions :actions="$this->getCachedFormActions()" :full-width="$this->hasFullWidthFormActions()" />` |
| `<x-filament-panels::form>` (no submit; reactive per-field save) | nothing — just `{{ $this->form }}` (Schema renders itself); keep `<x-filament-actions::modals />` |
| `<x-filament-panels::form.actions>` | `<x-filament::actions>` |
| `<x-filament-panels::page.unsaved-data-changes-alert />` | drop it (gone) |
| `<x-filament-tables::table/header-cell/row/cell>` | plain `<table>/<thead>/<tbody>/<th>/<td>` with Tailwind classes |
| `<x-filament::grid :default="N">` | `<div class="grid grid-cols-N gap-N">` |
| `<x-filament-forms::field-wrapper.label>` | plain `<label>` or a native schema/infolist entry |
| `<x-filament-infolists::entry-wrapper>` (now needs a `$url` prop) | prefer native `TextEntry->badge()`; if hand-rolling, reproduce the `fi-in-entry*` markup directly |

Still valid: `x-filament::section`, `x-filament::button`, `x-filament::badge`,
`x-filament-actions::modals`, `x-filament-panels::page`. When you must hand-roll an entry wrapper,
reproduce the v4 markup: `fi-in-entry` > `fi-in-entry-label-col`/`fi-in-entry-content-col` >
`fi-in-entry-label` (role="term") / `fi-in-entry-content` (role="definition").

### Pattern 12 - Custom badge/infolist views -> native entries

A hand-rolled badge-list `ViewEntry` that leaned on `<x-filament-infolists::entry-wrapper>` and
`$getState()` is fragile in v4. Prefer the native entry and delete the partial:

```diff
-ViewEntry::make('rel.name')->view('filament.infolist.badge-list', ['label' => 'labels.x']),
+TextEntry::make('rel.name')->label(__('labels.x'))->badge(),
```

v4 renders comma/array state as separate badges automatically.

### Pattern 13 - Nested-resource `getUrl()` parent parameters

v4 made nested `{parent}` route binding stricter; it no longer reliably auto-fills the parent
parameter for `Resource::getUrl()` calls made from outside that resource's page tree. Three fixes
depending on context:

- **You have the parent in context:** pass every parent route param explicitly. Keys must match the
  nested route segment names. When a parent Resource binds by id (`$recordRouteKeyName = 'id'`) but
  the model's route key is a slug, pass the parent's **id**, not the model (a model serializes to its
  slug -> the parent-walk resolver queries `where id = '<slug>'` -> 404):

  ```diff
   ->url(fn (Child $r): string => ChildResource::getUrl('edit', [
       'record' => $r,
  -    'parent' => $r->session->parent,
  +    'parent' => $r->session->parent->getKey(),
   ]))
  ```

- **The parent is inferable from the current page:** pass `shouldGuessMissingParameters: true`:

  ```diff
  -return ChildResource::getUrl('edit', ['record' => $record]);
  +return ChildResource::getUrl('edit', ['record' => $record], shouldGuessMissingParameters: true);
  ```

- **No parent context at all (e.g. global search):** return `null` from
  `getGlobalSearchResultUrl()` rather than emit a broken URL.

Apply to every nested-resource URL built from outside that resource (infolist/table action `->url()`,
relation managers, global search). Harden regression tests to actually `->get($url)->assertOk()`, not
just assert the URL string shape (an id-vs-slug mismatch only surfaces on resolution).

### Pattern 14 - Nested `{parent}` route binding & `mountParentRecord()`

v4 derives the parent route key from the **parent model name** (e.g. `{meeting}`); legacy v3 routes
use a generic `{parent}` placeholder. The default `mountParentRecord()` reads the model-derived key,
finds nothing, feeds `null` into `resolveRecordRouteBinding` -> `TypeError`. v4's default
`scopeEloquentQueryToParent` also scopes through a relation named after the parent model, which may
not exist when the child reaches its parent through a differently-named relation.

Workaround (keep the legacy `{parent}` placeholder working) — override `mountParentRecord()` to read
the real placeholder and **return cleanly when absent** (so non-nested/standalone pages sharing the
trait don't break), and scope through the real relation:

```php
public function mountParentRecord(): void
{
    if ($this->parentRecord) { return; }
    $parentKey = request()->route('parent') ?? request()->input('parent');
    if ($parentKey === null) { return; }
    $this->parentRecord = $this->getParentResource()::resolveRecordRouteBinding($parentKey);
    if (! $this->parentRecord) { throw new ModelNotFoundException; }
}

public static function scopeEloquentQueryToParent(Builder $query, Model $parentRecord): Builder
{
    return $query->whereBelongsTo($parentRecord, 'activity'); // real relation name, not the derived one
}
```

For a page registered **both** nested (with `{parent}`) **and** standalone, guard
`mountParentRecord()` with `getParentResourceRegistration()` (null for non-nested) +
`request()->route()?->hasParameter($registration->getParentRouteParameterName())`, and point
breadcrumbs at `static::getNavigationUrl()` (the standalone variant) instead of the nested `getUrl()`.
The durable fix is to rename `{parent}` to `{<parentModel>}` in the route + all callers.

### Pattern 15 - Hidden + disabled fields dehydrate to `null`

In v4 a field that is both **hidden and disabled** dehydrates to `null` (v3 effectively dropped it).
A `required` rule then trips before `mutateFormDataBeforeSave()` can inject a default. When a custom
action calls `$this->save()`, seed the Livewire form-state array directly **before** save (store the
scalar the field expects, e.g. an enum `->value`):

```diff
 ->action(function ($record) {
     $this->unmountAction();
+    $this->data['some_field'] = SomeStatus::SOME_DEFAULT->value;
     $this->save();
 });
```

### Pattern 16 - Enum-options fields return the enum INSTANCE via `$get()`

Reading a `->options(SomeEnum::class)` field via `Get $get` returns the backed-enum **instance**, not
its scalar. `$get('field') === SomeEnum::CASE->value` silently evaluates false. Drop the `->value`:

```diff
-fn (Get $get): bool => $get('status') === OrganizationStatus::MEMBER->value
+fn (Get $get): bool => $get('status') === OrganizationStatus::MEMBER
```

Audit every `$get(...) === Enum::CASE->value` and `match ($get(...)) { Enum::CASE->value => ... }`.
Silent failure -> cover the affected `required()`/`visible()`/match logic with a form test.

### Pattern 17 - Relation-manager hydrate-auth 403

v4's `Filament\Resources\RelationManagers\Concerns\CanAuthorizeAccess` registers a Livewire
**hydrate** hook (`hydrateCanAuthorizeAccess`) that calls `static::canViewForRecord($owner, $page)` on
every Livewire update and `abort_unless(..., 403)`. The default runs `viewAny` on the **relation
model**. There is no matching mount hook, so the check is **asymmetric**: the page mounts fine, then
**every** in-table interaction (sort, search, filter, click, open action) returns
`POST /livewire/update [403]` for a user who can view the parent but lacks `view_any_<relation_model>`.
This bites any View page whose `getRelationManagers()` bypasses the render-time filter (returns
`getRelations()` directly).

Override `canViewForRecord` on every affected relation manager to mirror the **parent** view gate:

```php
public static function canViewForRecord(Model $ownerRecord, string $pageClass): bool
{
    return $ownerRecord instanceof SomeOwnerModel && Gate::allows('view', $ownerRecord);
}
```

The `instanceof` guard hardens against an unexpected owner type. Per-row/bulk write actions are gated
separately, so this doesn't loosen write auth. **Not every relation manager is affected:** relation
models with **no registered policy** fall through to `Response::allow()` (e.g. spatie media-library
`Media`); pages using Filament's **default** `getRelationManagers()` are safe (render-time filter
hides unauthorized tabs). Keep any panel-specific `canViewForRecord` hide-override early-return at the
top of the method (and add a regression test for it, since the hydrate hook makes it security-relevant).
Sweep ALL relation managers attached to `getRelationManagers()`-bypass view pages.

### Pattern 18 - Joined-table column sort (`getJsonSafeColumnName` rewrite)

v4 rewrites any dotted sort column not starting with the model's own table prefix into JSON arrow
notation. A column sorted on a joined table (`users.last_name`) becomes
`json_extract(users, '$."last_name"')` -> invalid SQL. Use the closure form to bypass it:

```diff
 TextColumn::make('full_name')
-    ->sortable(['users.first_name', 'users.last_name'])
+    ->sortable(query: fn (Builder $q, string $direction): Builder => $q
+        ->orderBy('users.last_name', $direction)
+        ->orderBy('users.first_name', $direction))
```

Related: a table backed by an anonymous `Model {}` over a `fromSub()` union needs an explicit
`protected $table = '...'` so v4's column qualification during sorting resolves.

### Pattern 19 - Single-mode `SelectFilter` default must be scalar

In v4 a single-mode `SelectFilter` whose default helper returns an array crashes the table render with
`Array to string conversion`. Return a scalar id or `null`:

```diff
-private static function getDefaultFilterForStatus(): array { ... return [$id]; }
+private static function getDefaultFilterForStatus(): ?int { ... return $id; /* or null */ }
```

### Pattern 20 - `''` vs `null` navigation group

v4 treats `''` as a **distinct** navigation group from `null`, so a resource whose
`getNavigationGroup()` resolves to `''` (often from a base/package translation helper) lands in its
own blank-titled section. Coerce empty to null:

```php
public static function getNavigationGroup(): ?string
{
    return parent::getNavigationGroup() ?: null;
}
```

### Pattern 21 - Moved auth translation keys; decouple your labels

v4 reorganized built-in auth lang keys: `filament-panels::pages/auth/*` moved to
`filament-panels::auth/pages/*` (segments swapped; the tail like `.form.email.label` is unchanged).
A custom auth page resolving the old path renders the raw key. **Better:** stop borrowing the vendor
`filament-panels::pages/auth/*` namespace from your own resources entirely; point at your own
`lang/<locale>/labels.php` keys so labels are decoupled from Filament internals.

### Pattern 22 - `->label('')` -> `->hiddenLabel()`

The v4 idiom for hiding a label is `->hiddenLabel()`, not `->label('')`.

### Pattern 23 - `DatePicker` inherits `DateTimePicker::configureUsing()` (timezone shift)

`DatePicker extends DateTimePicker`, so a global `DateTimePicker::configureUsing(...)->timezone(...)`
default also applies to date-only pickers and shifts midnight across timezones (off-by-one dates).
Guard:

```php
DateTimePicker::configureUsing(function (DateTimePicker $c) {
    $c->defaultDateDisplayFormat(...);
    if (! $c instanceof DatePicker) { $c->timezone(DISPLAY_TIMEZONE); }
});
DatePicker::configureUsing(fn (DatePicker $c) => $c->defaultDateDisplayFormat(...)); // no ->timezone()
```

### Pattern 24 - `DateTimeStateCast` asymmetry (live pickers)

v4's `DateTimeStateCast` catches malformed input in `set()` but `get()` calls `Carbon::parse()`
unconditionally. A `->live()` native `datetime-local` picker can emit malformed intermediate values
mid-typing (e.g. a 6-digit year), and `get()` throws `InvalidFormatException` **before** any user
`afterStateUpdated()` body runs, so a try/catch in the callback can't help. Subclass and bind in the
container so every picker is protected:

```php
class SafeDateTimeStateCast extends \Filament\Schemas\Components\StateCasts\DateTimeStateCast
{
    public function get(mixed $state): ?string
    {
        try { return parent::get($state); }
        catch (\Carbon\Exceptions\InvalidFormatException) { return null; }
    }
}
// in a provider's register():
$this->app->bind(DateTimeStateCast::class, SafeDateTimeStateCast::class);
```

### Pattern 25 - Custom "save without validation" helpers must re-seed `$state`

v4's `Schema::getState()` seeds the local `$state` array from Livewire's raw component data (inside
`validate()`), and `dehydrateState($state)` reads from it. A custom helper that skips validation also
skips this seeding, so every untouched field dehydrates from null -> a partial save **nulls out**
unedited columns (NOT NULL columns then throw a DB integrity error). Seed `$state` yourself (restricted
to the keys the form owns via `array_intersect_key($rawState, array_flip(array_keys($form->getFlatFields(withHidden: true))))`),
and note `callBeforeStateDehydrated()` gained a required `$state` arg and
`loadStateFromRelationships(andHydrate:)` was renamed to `shouldHydrate:`. Any code copying Filament
internals (`getState`/`dehydrateState`/`callBeforeStateDehydrated`) is fragile — diff against the v4
`Filament\Schemas\Schema` source after upgrade.

### Pattern 26 - Custom fields on `Schemas\Components\Component`

A custom field extending `Filament\Schemas\Components\Component` must add the `HasLabel` trait (label
handling is no longer inherited the v3 way), import `HasName` from
`Filament\Schemas\Components\Concerns`, and update `getChildComponents()` to accept the new
`?string $key = null` parameter. Replace a header action's removed `$this->closeActionModal()` with
`$this->unmountAction()` (unmount-before-save so a validation failure doesn't also close the modal).

### Pattern 27 - Cross-panel cluster breadcrumb route

A package resource that extends an app `Cluster` (inheriting its route prefix) and is registered in
more than one panel throws `RouteNotFoundException` while building breadcrumbs in a panel that does
**not** register the cluster index page (v4's `Cluster::unshiftClusterBreadcrumbs()` calls `route()`
on the cluster route name). No-op when the route is absent:

```php
public static function unshiftClusterBreadcrumbs(array $breadcrumbs): array
{
    if (! Route::has(static::getRouteName())) { return $breadcrumbs; }
    return parent::unshiftClusterBreadcrumbs($breadcrumbs);
}
```

---

### Pattern 28 - Topbar render-hook reordering

v4 restructured the topbar: `PanelsRenderHook::TOPBAR_START` now renders **before** the
`.fi-topbar-start` logo wrapper, so custom content injected there (e.g. a panel switcher) lands at
the far left of the brand instead of beside it, silently and with no error. v4 added
`PanelsRenderHook::TOPBAR_LOGO_AFTER` for content that should sit right after the logo. Use it and
add `ms-4` (logical margin-start, RTL-safe) for spacing:

```php
// before (v3) - sat next to the logo
$panel->renderHook(PanelsRenderHook::TOPBAR_START, fn () => view('some.topbar-extra'));

// after (v4) - TOPBAR_START is now left of the brand; use the new hook
$panel->renderHook(PanelsRenderHook::TOPBAR_LOGO_AFTER, fn () => view('some.topbar-extra'));
// in the view's root element: class="ms-4"
```

---

### Pattern 29 - Vendor-shadow override classes (latent `class.notFound`)

Repos that override a third-party class keep a thin subclass under an app namespace (commonly
`App\Vendor\...`) that `extends \SomeVendor\...`, wired in via a config map or container binding. When v4
**moves, removes, or re-types the parent** (a model that became an enum, a class relocated to another
namespace), the override breaks silently: the class only loads when something instantiates it, so the app
**boots and the panel crawl passes** — it fatals only on the code path that resolves it. `mergeConfigFrom`
makes this worse by backfilling the package's new default, so even the config appears to work.

For each vendor-shadow override found in the audit:
- Confirm the v4 parent still exists with the same shape (`composer show`, or grep the vendor dir).
- If the parent moved/changed: repoint the override and **every config map / binding that references the
  old FQCN** (grep `config/` and service providers for the class name).
- If v4 made the override obsolete (e.g. the parent is now an enum, so there is nothing to subclass):
  **delete it** and update the config map to the v4 target.

This is exactly the error the PHPStan/Larastan gate reports as a non-ignorable `class.notFound` /
`method.override` — see the concrete `lara-zeus/bolt` `FormsStatus` case in Phase 4.

---

## Phase 3 - Tailwind v4 migration

1. **Entry CSS:** replace `@tailwind base/components/utilities/variants` (and bare relative imports)
   with a single `@import "tailwindcss";`. Declare content sources with `@source` (replaces
   `tailwind.config.js` `content[]`) and the palette with `@theme { --color-primary-500: #...; }`
   (replaces the JS color config). `tailwind.config.js` becomes obsolete.

   ```css
   @import "tailwindcss";
   @import '../../vendor/filament/support/resources/css/index.css';
   @source '../../app/Filament/**/*';
   @source '../../resources/views/**/*.blade.php';
   @source '../../vendor/filament/**/*.blade.php';
   @theme { --color-primary-500: #06E12D; }
   ```

2. **External `@import url(...)` must come first.** Tailwind v4 + Lightning CSS rejects `@import url(...)`
   nested inside a `layer()`-imported partial. Hoist font imports to the very **top** of the entry CSS
   (above even `@import "tailwindcss";`) and delete the layer-wrapped partial. Symptom otherwise:
   `Unknown at rule: @import` build warnings.

3. **Build tooling:** drop `postcss` + `autoprefixer` (+ `postcss-nesting`), add `@tailwindcss/vite ^4`,
   add `tailwindcss()` to `vite.config.js` plugins, reset `postcss.config.js` to `{ plugins: {} }`.

4. **Typography plugin is no longer bundled.** Install `@tailwindcss/typography` and register it in the
   theme CSS with `@plugin '@tailwindcss/typography';` (Tailwind v4 dropped the `plugins: []` array;
   plugins load via the `@plugin` at-rule). Without this, `prose` produces no styling. Same for
   `@tailwindcss/forms` / `aspect-ratio` if used. Install with `ddev yarn add -D @tailwindcss/typography`.

5. **`@apply` of author-defined classes is gone.** Tailwind v4 only `@apply`s utilities it knows. Fold
   selectors that wanted a custom class (`@apply richEditorTable`) into a comma-separated selector list
   instead. `@apply` of genuine utilities (`border-separate`, `rounded-lg`, ...) still works.

6. **Safelist via `@source inline("...")`** in theme CSS (replaces v3's `safelist[]`). Add classes
   used only inside **vendor** blade (Tailwind doesn't scan `vendor/`): e.g.
   `@source inline("opacity-25 size-2 size-4 size-6 inline-block");`. Alternatively add
   `@source '../../../../vendor/<vendor>/<pkg>/**/*.blade.php';`. This recurs for `statikbe/*` leisure,
   printable, archivable views (e.g. `opacity-25` applied via `Table::configureUsing()`, `inline-block`
   on a status-select item view).

7. **Cascade layers are the tiebreaker.** Import app overrides into the **same** layer as the Filament
   rules they fight (`layer(components)`), so a later import wins. v4 sets `padding: ... !important` on
   `.fi-fo-rich-editor .tiptap table td/th`, so cell-padding overrides need `!important` (`!px-3 !py-2`),
   and `border-0` zeros the default per-cell border.

8. **Renamed `fi-*` selectors** (inspect the running v4 DOM; some shift between v4 minors):

   | v3 | v4 |
   |---|---|
   | `.tiptap-prosemirror-wrapper .tiptap-content .tiptap` | `.fi-fo-rich-editor-content .tiptap` (wrapper `.fi-fo-rich-editor`, toolbar `.fi-fo-rich-editor-toolbar`) |
   | `.fi-in-entry-wrp-label > span` | `.fi-in-entry-label` (no inner span) |
   | `.fi-fo-field-wrp-label > span` | `.fi-fo-field .fi-fo-field-label-content` |
   | `label.fi-fo-checkbox-list-option-label` | `label.fi-fo-checkbox-list-option` |
   | (TextEntry icon wrapper, v3 `h-5 w-5` + 6px gap) | wrapper dropped; size derives from text (`text-sm` -> `h-4 w-4`); restore in CSS — no `iconSize()` setter in v4 (`->size(TextSize::Medium)` also bumps text) |
   | `.choices` / `.choices__input` (Choices.js) | **gone** — v4 dropped Choices.js for selects; delete the overrides |

9. **RichEditor sticky toolbar** (v4 selectors + responsive offset for the topbar):

   ```css
   .fi-fo-rich-editor .fi-fo-rich-editor-toolbar { position: sticky; top: 0; z-index: 10; }
   @media (min-width: 640px) {
       .fi-fo-rich-editor .fi-fo-rich-editor-toolbar { top: 4rem; } /* clear Filament's h-16 (4rem) topbar; mobile topbar collapses, hence top: 0 below sm */
   }
   ```

10. **Inactive select/filter styling:** v4 styles selects with `ring-1` + a gray ring, not a `border`.
    Do NOT hard-code the bare `border` utility (resolves to `currentColor` -> near-black 1px) nor
    `!shadow-none !ring-0` in select/filter `extraAttributes`. Return an **empty class string** for the
    inactive branch so the default ring/shadow survives; only add emphasis classes for the active
    branch:

    ```diff
     'class' => $get($fieldName) !== self::FILTER_OPTION_ALL
         ? 'border-primary-300 !bg-primary-50'
    -    : 'border !shadow-none !ring-0',
    +    : '',
    ```

11. **Non-panel pages that render schema components** (a public Livewire form outside a panel) no
    longer inherit panel CSS (v4 split it out of `@filamentStyles`). Import the per-package CSS into
    that bundle:

    ```css
    @import '../../vendor/filament/support/resources/css/index.css';
    @import '../../vendor/filament/forms/resources/css/index.css';
    @import '../../vendor/filament/schemas/resources/css/index.css';
    @import '../../vendor/filament/infolists/resources/css/index.css';
    ```

12. **Color palette regeneration changed.** `Color::generatePalette()` now keeps only the hue of a
    single hex and rebuilds lightness/chroma from fixed OKLCH constants, so a dark, saturated brand
    color looks washed out at shade 600. Pass an explicit `50..950` shade-keyed array anchored at the
    shade Filament uses (600) for the colors that look wrong; survivable hues can stay single-hex.

13. **Build with `ddev yarn run build`** (bare `yarn` hits rolldown native-binding errors). To make a
    UI change show up, the user may need `ddev yarn run build` / `ddev yarn run dev`.

---

## Phase 4 - Package compatibility (Shield, impersonate, leisure family, permission)

### Shield v4

- **Config is rewritten, not bumped.** `permission_prefixes` / `entities` / `generator` become
  `permissions` (with `separator` / `case` / `generate`), `policies`, and `resources.manage`;
  `auth_provider_model` flattens from `['fqcn' => User::class]` to `User::class`. Republish and
  re-apply your custom settings (`tenant_model`, `super_admin.define_via_gate`/`intercept_gate`,
  `shield_resource.*`, prefixes, page/widget exclusions).
- **Permission KEY format changed.** Existing DB permissions break unless v4 keeps producing the same
  names. Two complementary controls:
  - Pin `permissions.separator` to whatever the DB already stores (e.g. `'::'` if existing names use
    it), so you don't have to re-migrate every role.
  - Preserve the full v3 key format with `FilamentShield::buildPermissionKeyUsing(...)` in
    `AppServiceProvider::boot()` (match `Resource` -> `<affix>_<snake-resource-basename-without-Resource>`
    with your separator, `Page` -> `page_<basename>`, `Widget` -> `widget_<basename>`).
- **Removed `FilamentShield::getPermissionIdentifier()`.** Derive the resource key yourself:
  `Str::of(static::class)->afterLast('\\')->beforeLast('Resource')->snake()->replace('_', '::')`
  (match your configured separator).
- **Custom (non-CRUD) permissions go in `resources.manage`**, keyed by Resource FQCN:
  `ResourceClass::class => ['publish', 'view_participant_count', ...]`. v3 had no such map, so extra
  abilities are silently missing until added. The resource's own custom action `->authorize()` must
  reference the same ability name. Regenerate with `shield:generate`.
- **Multi-panel generation needs `Illuminate\Support\Once::flush()` between panels** (v4 `once()`
  caching otherwise blocks per-panel resource discovery).
- **Seed hang on tenant-heavy DBs:** when `filament-shield.super_admin.enabled` is true,
  `shield:generate` runs `Utils::giveSuperAdminPermission()` which iterates **every tenant** per
  permission -> millions of round-trips. If the seeder grants super_admin its permissions manually,
  temporarily `config(['filament-shield.super_admin.enabled' => false])` around the `shield:generate`
  calls (restore the original value after).
- **Tenant scope on the Role model:** if roles are intentionally **global** (`organization_id = NULL`,
  tenancy on the `model_has_roles` pivot), Shield's default tenant scope adds
  `WHERE roles.organization_id = <tenant>` and hides the global `super_admin` role on tenant panels.
  Disable per-panel: `FilamentShieldPlugin::make()->scopeToTenant(false)`. Only on panels where roles
  must be global; assert with `$plugin->isScopedToTenant()` / `Role::hasGlobalScope(...)`.
- **Keep the deprecated `HasShieldPermissions` contract** (still functional in v4) with a TODO; don't
  rewrite all the implementing resources during the upgrade.

### spatie/laravel-permission v7

- Diff `config/permission.php` against the published v7 config rather than re-publishing blind (keep
  your model bindings and `teams => true`). New keys: `events_enabled`, `team_resolver`. The wildcard
  config key renamed `permission.wildcard_permission` -> `wildcard_permission` (silently ignored
  otherwise).
- **`->role($name)` query scope throws `RoleDoesNotExist`** under a foreign `team_id` (it resolves via
  team-aware `findByName`; reachable from observers/jobs running under a different team than the role
  owner). Replace with a direct pivot query:
  `whereHas('roles', fn (Builder $q) => $q->where('roles.name', $name))`.
- **Multi-tenant cached-permission `can()` override:** a custom `User::can()`/`canAny()` that bridges
  team-scoped cached permissions must, on a cache miss, **always** consult the Gate (not only when
  extra `$arguments` are passed) so `Gate::define`/`before`/`after` and no-arg policy checks still
  resolve. Use strict `in_array(..., true)`.
- **Global "manage all tenants" check across Livewire replays:** Livewire v3 replays persistent
  middleware once per component snapshot; `SyncShieldTenant` flips the active team id to the tenant
  between replays, hiding globally-seeded super-admin roles from later snapshots (-> intermittent
  tenant 404/error modal). Evaluate the global permission with the team context explicitly set to the
  global team id via a set-team-run-restore wrapper.
- **Per-resource tenant opt-out:** a resource whose model lacks the tenant FK gets a broken
  `where tenant` clause injected by the panel. Set `protected static bool $isScopedToTenant = false;`
  on it (this is the Filament resource property, distinct from Shield's panel-level `scopeToTenant`).

### Impersonate (v4 then v5)

- v4: action namespace move `STS\FilamentImpersonate\Tables\Actions\Impersonate` (or older
  `Pages\Actions\`) -> `STS\FilamentImpersonate\Actions\Impersonate`. Pure import swap.
- v5: the API changes substantially — drop the `Lab404\Impersonate\Models\Impersonate` user trait,
  events move from `Lab404\Impersonate\Events\*` into `STS\FilamentImpersonate\Events\*`,
  `TakeImpersonation` is renamed `EnterImpersonation`, and events are **no longer auto-wired** —
  register the listeners manually in `boot()` (`Event::listen(EnterImpersonation::class, ...)`,
  `Event::listen(LeaveImpersonation::class, ...)`). Old listeners type-hinting the Lab404 events stop
  firing silently.

### Leisure / archivable / printable family (statikbe/* forks)

- **Archivable:** model `Archivable` trait via `joelbutcher/laravel-archivable`; Filament UI
  (`ArchiveAction`, `UnArchiveAction`, `ArchivedFilter`, dimmed archived rows) via the
  `statikbe/filament-archivable` fork under the `Statik\FilamentArchivable\*` namespace (replaces the
  non-v4 `Okeonline\FilamentArchivable\*`). The plugin applies `opacity-25` to archived rows via
  `Table::configureUsing()`, so safelist `opacity-25`. Delete the app's old local `ArchivedFilter` and
  the hand-rolled archive/unarchive header actions.
- **Printable:** `statikbe/filament-printable` `PrintAction` uses the v4 `actionJs()` API for
  client-side `window.print()`. **Avoid `"` inside JS string literals injected via Blade component
  attributes** — `ComponentAttributeBag` escapes them to `\"` and breaks the HTML; bump to the fork
  release that reworks the literal.
- **Leisure resources:** v4 patches (e.g. `columnSpanFull()` on a participants-count column) land
  **package-side**; pin the fork to its tagged v4 release (`^4.1`) and smoke-test each leisure list page
  mount (`Livewire::test(<ListPage>::class)->assertSuccessful()` with the panel selected).
- **Flexible content blocks:** v4 removed `FlexibleRichEditorField`, the `RichEditorConfigurator`
  interface, and the `'rich_editor'` config section. Migrate every call site to the built-in
  `RichEditor` (route shared rules through `RichEditor::configureUsing()` — Pattern 10) and delete the
  dead config. Re-add any shared rule deliberately: dropping the wrapper silently removes validation v3
  enforced.
- **CMS catch-all route shadowing panel URLs:** Filament 4.11.2 made tenant root dashboard routes
  `->fallback()` routes. A non-fallback catch-all (`{parent}/{page}`) from a CMS package then
  out-ranks two-segment panel URLs (`/portaal/{tenant}`) -> 404. Pin the package to a branch whose
  route registration excludes panel prefixes via
  `Route::where(['parent' => '^(?!(prefix1|prefix2|admin|account)).*$', 'page' => '.*'])`.
  This can surface well after the initial v3->v4 jump, when bumping Filament patch/minor versions.
- **`lara-zeus/bolt` `FormsStatus` (Models -> Enums):** in Bolt v4 the form status is an enum
  (`LaraZeus\Bolt\Enums\FormsStatus`) resolved via `BoltPlugin::getEnum('FormsStatus')`, which reads a
  **new `config('zeus-bolt.enums')` block** — it is no longer the Sushi model
  `LaraZeus\Bolt\Models\FormsStatus`. In the app's `config/zeus-bolt.php`: drop the stale
  `models.FormsStatus` mapping, add the `enums` block pointing at `\LaraZeus\Bolt\Enums\FormsStatus`, and
  **delete any `app/Vendor` override of the old Sushi model** (the in-memory-cache reason it existed is
  gone in v4). This is the canonical **Pattern 29** case: `mergeConfigFrom` backfills the package default
  so the panel boots even with the stale app config — it only fatals when `getEnum()` runs (response-status
  dropdowns + the `ResponsesPerStatus` widget). The PHPStan gate flags the broken override before it can.

---

## Phase 5 - Verification

Run every code phase against the **shared verification gate** and don't report success until green:

```bash
ddev php artisan test --compact
vendor/bin/pint --dirty --format agent
ddev composer analyse          # PHPStan/Larastan; bare phpstan fails outside DDEV
ddev yarn run build            # never bare yarn (rolldown native-binding errors)
ddev php artisan filament:upgrade   # re-vendor if the lock moved any Filament package
```

**Commit each phase as you go.** Once a phase's gate is green, commit that phase's changes as a focused,
conventional commit (group logically — more than one commit per phase is fine; never bundle unrelated
work; keep regenerated assets / IDE-helper churn in their own commit or revert it; follow the repo's
commit conventions, which may sign commits). You then review commits, not one giant working tree. NEVER
push or open a PR — that is the user's call.

### PHPStan (Larastan) fixes after the bump

**If the repo has no static-analysis gate yet, wire one as part of the upgrade** (see **Gate tooling**):
`larastan/larastan` + a `phpstan.neon` (level 5 over `app`/`bootstrap`/`config`/`database`/`routes`) + an
`analyse` script, with a `phpstan-baseline.neon` grandfathering pre-existing legacy findings so the gate is
green and only new code is checked. This is not optional polish — a clean boot and a full panel crawl do
**not** surface v4's class/namespace moves (a relocated vendor class, a model that became an enum, a
vendor-shadow override whose parent disappeared — Pattern 29). Larastan reports those as non-ignorable
`class.notFound` / `method.override`; nothing else in the gate does.

**Watch for an ide-helper `@mixin` blanket-mute.** If PHPStan looks suspiciously clean, check whether
the repo has `@mixin \IdeHelper...` annotations on its models plus a `scanFiles` directive in
`phpstan.neon` pointing at a generated `_ide_helper_models.php`. That scaffolding makes PHPStan assume
any symbol it can't resolve lives on the IdeHelper class — a blanket mute that hides exactly the v4
class/namespace/cast findings you need. Drop the `@mixin` annotations and the `scanFiles` directive (or
regenerate the ide-helper file) so real findings surface, then fix them (date-cast `@property`
annotations, `BelongsTo<X, $this>` generics, `\BackedEnum` -> the concrete enum in Exporters, etc.).

Once wired, the v4 type/method renames surface as a batch:

- `@property Form $form` docblocks -> `@property Schema $form` (this is what lets fluent
  `->getOperation()`/`->getRecord()` chains type-check).
- `form()`/`infolist()` bodies still naming `$form`/`$infolist` -> `$schema`.
- Custom field on `Schemas\Components\Component`: add `HasLabel`, fix `getChildComponents(?string $key = null)`.
- `loadStateFromRelationships(andHydrate:)` -> `shouldHydrate:`.
- Header `->action()` `$this->closeActionModal()` -> `$this->unmountAction()`.
- Broaden the generic-builder ignore if v4 exposes `Builder<Model>` calls:
  `'#Call to an undefined method Illuminate\\Database\\Eloquent\\Builder(<.*>)?::#'`.

### v4 test-API adaptations

- Removed `callFormComponentAction()` / `assertFormComponentActionHidden()` ->
  `callAction(TestAction::make('action')->schemaComponent('field'))` /
  `assertActionDoesNotExist(TestAction::make('action')->schemaComponent('field'))`.
  `TestAction` is `Filament\Actions\Testing\TestAction`; row actions use `->table($record)`.
- Relation-manager header actions: prefer the `callTableAction('name', data: [...])` macro over
  `callAction(TestAction::make('name')->table())` (the latter intermittently throws
  `Attempt to read property 'mountedActions' on null`).
- **"mountedActions on null" usually means a hydrate-time 403**, not a test-API problem: the acting
  user lacks `view_any_<resource>` / `view_any_<relation>`. Grant `super_admin` (or the missing view
  permission); the behavior under test lives in the action callbacks, not the access policy.
- Call `app(Spatie\Permission\PermissionRegistrar::class)->forgetCachedPermissions()` after creating
  permissions/roles in a test; set the permissions team in `beforeEach` for tenant tests.
- Regression-test Pattern 17 by driving a hydrate cycle: `->sortTable(...)` or
  `->set('tableSearch', 'x')` then `->assertSuccessful()`, acting as a user who has the parent `view`
  perm but not `view_any_<relation>`.
- **Empty-table smoke tests are not enough under v4** (it evaluates row-action closures per record).
  Seed at least one record and `->assertCanSeeTableRecords([$record])`. Select the panel first with
  `Filament::setCurrentPanel(Filament::getPanel(...PANEL_ID))` for package/resource list pages.

### Silent-403 observability net

v4's hydrate-auth 403s are invisible (`HttpException` is in Laravel's `internalDontReport`). Make them
observable:

- `registerErrorNotification(title:, body:, statusCode: 403)` on the **shared base** panel provider so
  all panels show a clear "no access" toast instead of the generic error.
- In `bootstrap/app.php`: `$exceptions->stopIgnoring(HttpException::class)` + a `reportable` closure
  that `Log::warning`s only Livewire 403s (with `user_id`, referer, parsed `components.*.calls`) and
  **returns false** so non-Livewire 403s/404s stay quiet.

### Common runtime 500s to expect

`view:cache` failures from removed blade components (Pattern 11); `Array to string conversion` on
table render (Pattern 19); `RouteNotFoundException` from cross-panel cluster breadcrumbs (Pattern 27) or
from a guest-redirect to a `route('login')` that does not exist (Gotcha catalog);
`json_extract(...)` SQL errors on sort (Pattern 18); `TypeError` on RichEditor string ops (Pattern 10);
nested-route binding `TypeError`/404 (Patterns 13-14); silent no-op buttons from swallowed Action DI
failures (Pattern 5). Match symptoms against the Gotcha catalog.

### Panel crawl checklist

Breaking changes surface only at runtime on specific pages/interactions. Keep a findings log so each
pass resumes where the last stopped. Drive the crawl as super_admin across **every** registered panel
(admin + each tenant portal + account/onboarding + website/CMS), using **real sample record IDs** so
nested-route binding is exercised, and every `?relation=` tab on edit pages.

If a **Playwright** or **Chrome DevTools MCP** is available (see the Pre-flight tooling check), drive
this crawl through it — navigate each route, then read HTTP status, console errors, and failed network
requests per page; pair with Laravel Boost's `browser-logs` for server-side exceptions. Without a
browser MCP, fall back to feature/smoke tests that `get()` each route and assert 200 + no logged error.

- **Page-level (GET):** index/dashboard; `*/create`; edit/view with sample records; nested routes with
  real ids; edit with each `?relation=` tab; logged-out auth/onboarding pages (register,
  accept-invitation, password-reset request/reset, update-password — an expected 403 on the
  signed-URL reset gate is fine); locale variants (if more than one is enabled); tenant-switcher
  direct-URL access (including a tenant the user shouldn't access -> expect a clean bounce, no 500).
- **Interaction-level (Livewire):** header/row/bulk actions; table filters; global search;
  notification + user dropdowns; impersonate round-trip (`/filament-impersonate/leave`); sortable
  columns (including relationship + aggregate sorts); repeater/builder field interactions; file-upload
  field mount; rich-editor block tree (flexible-content-blocks renderer); toggleable-columns dropdown;
  pagination next-page + per-page selector; edit-form save lifecycle (`POST /livewire/update` with no
  error/notification glitch).

Record HTTP status + console + `laravel.log` per request. For every regression found, fix it (match
the symptom against the Gotcha catalog below) and add a permanent feature test.

---

## Gotcha catalog (symptom -> cause -> fix)

| Symptom | Cause | Fix |
|---|---|---|
| Composer won't resolve `filament/filament: ^4.0` | A dependent plugin still on v3 | Bump every Filament plugin in the same change; replace/remove non-v4 ones (matrix) |
| `composer install` fails in CI: lock references `"dist": {"type": "path"}` | Committed lock built with the `composer.local.json` path-fork overlay | Re-lock without overlay: `composer update statikbe/* --no-plugins` |
| Panel JS/CSS behaves like v3 (rich editor, file upload, selects) | Stale published vendor assets in `public/{css,js}/filament/**` | `ddev php artisan filament:upgrade`; commit as a separate asset-refresh commit |
| `Vite::asset('resources/img/...')` 404s | New Vite tree-shook the unused `import.meta.glob` | `import.meta.glob([...], { eager: true, query: '?url', import: 'default' })` |
| Custom topbar element (panel switcher) jammed to far-left of the brand after upgrade | v4 renders `TOPBAR_START` before the `.fi-topbar-start` logo wrapper | Switch the hook to `PanelsRenderHook::TOPBAR_LOGO_AFTER` + `ms-4` spacing (Pattern 28) |
| Class-not-found `Filament\Tables\Actions\*` / `Filament\Forms\Form` / `Filament\Resources\Components\Tab` | v4 namespace consolidation / moves | Patterns 1-2; actions -> `Filament\Actions\`, layout -> `Filament\Schemas\Components\`, `Form` -> `Schemas\Schema` |
| `Class Filament\Schemas\Components\TextInput not found` | Migration sweep wrongly moved a form **input** into `Schemas\Components` | Move inputs back to `Filament\Forms\Components\` (Pattern 1) |
| Blade "Unable to locate a class or view for component [filament-...]" (often only at deploy `view:cache`) | Removed v3 blade component/sub-component | Pattern 11 replacement table |
| `Undefined variable: $form` / `$infolist` | `form()`/`infolist()` body not updated to `$schema` | Pattern 2 |
| Bulk/table action button does nothing, no error | Typed `BulkAction`/`Set`/`Get` param on `->action()` closure -> swallowed DI failure | Pattern 5: resolve by name; vendor case -> thin subclass |
| Vendor schema/form Action ("AI fill") does nothing | Vendor `->action()` typehints `Set $set` -> `BindingResolutionException` swallowed | Pattern 5: local subclass re-binding `->action()` by name |
| `disableOptionWhen` never fires / TypeError | v4 value-based closure signature | Pattern 6 |
| Select options show raw ids/blank labels (silent) | `->relationship()` called twice, resetting `getOptionLabelUsing` | Pattern 7: bind relationship once, forward `modifyQueryUsing` |
| Nested `Section`/`Grid`/`Fieldset` render one-column-narrow | v4 dropped default `columnSpanFull()` | Pattern 9: `configureUsing` in a provider |
| `TypeError: str_contains(): ... array given` on save | RichEditor value is ProseMirror JSON array, not HTML | Pattern 10: `RichContentRenderer::make($value)->toHtml()` before string ops |
| Inline RichEditor images broken / `<img data-id>` unresolved on view pages | Raw `{!! $html !!}` doesn't resolve attachment placeholders | Pattern 10: render via `RichContentRenderer`; match attachment disk/visibility, set `'public'` |
| RichEditor content unstyled / tables lose borders on view pages | v4 typography keys off `fi-prose`, not `prose` | Wrap in `fi-prose`; render through `RichContentRenderer` |
| `Missing required parameter` / 404 on a nested-resource URL | v4 doesn't auto-fill `{parent}`; or model serialized to slug while parent binds by id | Pattern 13: pass parent params explicitly (`->getKey()`), or `shouldGuessMissingParameters: true`, or return `null` from global-search URL |
| Nested resource page `TypeError`/`BadMethodCallException` on mount | `mountParentRecord()` reads model-derived key vs legacy `{parent}`; `scopeEloquentQueryToParent` uses wrong relation | Pattern 14 |
| Standalone variant of a dual-registered page crashes on mount/breadcrumb | `mountParentRecord()` resolves an absent `{parent}`; breadcrumb `getUrl()` needs it | Pattern 14: guard with `getParentResourceRegistration()` + `hasParameter()`, breadcrumb -> `getNavigationUrl()` |
| Hidden+disabled field fails `required` validation in a custom action | v4 dehydrates hidden+disabled to `null` (v3 dropped it); trips before `mutateFormDataBeforeSave` | Pattern 15: seed `$this->data[...]` before `$this->save()` |
| Reactive `required()`/`visible()`/`match` on enum field silently misfires | `$get()` returns enum **instance**, not `->value` | Pattern 16: compare against the enum case directly |
| `POST /livewire/update [403]` on every relation-manager interaction | v4 hydrate hook runs `viewAny` on relation model; page mounted via `getRelationManagers()` bypass | Pattern 17: override `canViewForRecord` to mirror parent `view` gate |
| `Unknown column 'users' in 'order clause'` / `json_extract(users,...)` on sort | v4 `getJsonSafeColumnName` rewrote a joined-table dotted column | Pattern 18: closure form `sortable(query: ...)` |
| `Array to string conversion` at table render | Single-mode `SelectFilter` default returned an array | Pattern 19: return scalar id or `null` |
| Resource in its own blank-titled sidebar section | v4 treats `''` nav group as distinct from `null` | Pattern 20: coerce `parent::getNavigationGroup() ?: null` |
| Auth-page labels render as raw `filament-panels::pages/auth/...` keys | v4 moved keys to `filament-panels::auth/pages/*` | Pattern 21: swap segments, or decouple to app `labels.*` |
| Date-only field shows/saves one day off | `DatePicker` inherited `DateTimePicker::configureUsing()->timezone()` | Pattern 23: `instanceof DatePicker` guard, no timezone on date-only |
| Live date picker crashes `InvalidFormatException` mid-typing | `DateTimeStateCast::get()` parses unconditionally; throws before `afterStateUpdated` | Pattern 24: `SafeDateTimeStateCast` bound in container |
| Partial save nulls out untouched columns / NOT NULL DB error | Custom "save without validation" helper skips v4's `$state` seeding | Pattern 25: re-seed `$state` from Livewire raw data |
| Custom field: `getChildComponents() incompatible signature` / no label | v4 `Schemas\Components\Component` API change | Pattern 26: add `HasLabel`, `getChildComponents(?string $key = null)` |
| `Call to an undefined method ... closeActionModal()` | Removed from header action closures in v4 | `$this->unmountAction()` |
| PHPStan flood after bump (`Form`, `$form`, `getChildComponents`, `andHydrate`, `closeActionModal`) | v4 type/method renames | Phase 5 PHPStan section |
| Test: `callFormComponentAction does not exist` | v4 removed the v3 component-action test helpers | `callAction(TestAction::make(...)->schemaComponent(...))` |
| Test: `Attempt to read property 'mountedActions' on null` | Hydrate-time 403 (user lacks `view_any_*`); or `TestAction->table()` flakiness | Grant `view_any`/super_admin; use `callTableAction` macro |
| Empty smoke test stays green but list page breaks with data | v4 evaluates row-action closures per record | Seed a record + `assertCanSeeTableRecords([$record])` |
| `prose` produces no styling | Tailwind v4 no longer bundles typography | Install `@tailwindcss/typography` + `@plugin '@tailwindcss/typography';` |
| Build: `Unknown at rule: @import` warnings | External `@import url(...)` nested in a `layer()`-imported partial | Hoist font imports to the very top of the entry CSS |
| Build: "cannot apply unknown utility class `richEditorTable`" | `@apply` of an author-defined class (gone in v4) | Fold into a comma-separated selector list |
| Custom theme CSS silently stops matching | Renamed `fi-*` selectors (Phase 3 table) | Update selectors against the rendered v4 DOM |
| Harsh dark 1px border + no focus ring on inactive select/filter | Hard-coded `border !shadow-none !ring-0` in `extraAttributes` | Return empty class string for the inactive branch (Phase 3 step 10) |
| Sticky RichEditor toolbar sits under the topbar | Topbar is `h-16` (4rem) and collapses on mobile | Sticky `top: 0`, `@media (min-width:640px){ top: 4rem }` (Phase 3 step 9) |
| Public (non-panel) Filament form renders unstyled | v4 split panel CSS out of `@filamentStyles` | Import `vendor/filament/{support,forms,schemas,infolists}/resources/css/index.css` into that bundle |
| Brand color washed out at shade 600 | `Color::generatePalette()` keeps only hue, rebuilds lightness | Explicit `50..950` palette anchored at 600 |
| Vendor blade class (e.g. `inline-block`) not applied | Tailwind v4 doesn't scan `vendor/` | `@source inline("...")` safelist or `@source` the vendor blade dir |
| `RoleDoesNotExist` from a `->role(...)` query scope | spatie teams: `findByName` under a foreign `team_id` | `whereHas('roles', fn ($q) => $q->where('roles.name', $name))` |
| Global super-admin denied on a tenant panel intermittently / tenant 404 modal | `SyncShieldTenant` flips team id between Livewire snapshot replays | Run the global check under the global team id (set-team-run-restore) |
| Gate/policy ability returns false for an allowed user (v4 tenant panel) | Custom `can()` override only deferred to Gate when args present | Always consult the Gate on cache miss (strict `in_array(..., true)`) |
| Global `super_admin` role invisible on tenant panel | Shield default tenant scope on the Role model | `FilamentShieldPlugin::make()->scopeToTenant(false)` |
| Resource page/widget empty or throws on a tenant panel | Panel tenant-scopes a model with no tenant FK | `protected static bool $isScopedToTenant = false;` on the resource |
| `db:seed` hangs forever | Shield v4 `giveSuperAdminPermission()` iterates every tenant per permission | Temporarily disable `super_admin.enabled` around `shield:generate` |
| `shield:generate` only discovers one panel's resources | v4 `once()` caching | `Once::flush()` between panels |
| Existing roles lose all permissions after Shield bump | v4 permission key/separator format changed | Pin `permissions.separator` to the stored format + `buildPermissionKeyUsing(...)` |
| `Call to undefined method getPermissionIdentifier()` | Shield v4 removed the helper | Derive the resource key with `Str::of(...)->afterLast->beforeLast->snake->replace` |
| Custom ability never generated by `shield:generate` | Not declared in `resources.manage` | Add `ResourceClass::class => ['<ability>']` |
| Impersonate `Class ...Tables\Actions\Impersonate not found` | v4 action consolidation | `use STS\FilamentImpersonate\Actions\Impersonate;` |
| Impersonate listeners stop firing after v5 | Events renamed/moved, no longer auto-wired | Register `EnterImpersonation`/`LeaveImpersonation` listeners in `boot()`; drop the Lab404 trait |
| Printable print button renders broken / `\"`-escaped HTML | `"` in injected JS literal escaped by `ComponentAttributeBag` | Bump to the fork release that reworks the JS literal without `"` |
| `Okeonline\FilamentArchivable\...` not found | Old archivable package not v4-compatible | Use `Statik\FilamentArchivable\*` fork |
| `RouteNotFoundException` building a cluster breadcrumb in a panel | Package resource extends a cluster registered only in another panel | Pattern 27: override `unshiftClusterBreadcrumbs()` to no-op when `! Route::has(static::getRouteName())` |
| Two-segment panel URL (`/portaal/{tenant}`) 404s after Filament 4.11.2 | Non-fallback CMS catch-all out-ranks the fallback tenant root route | Pin the CMS package to a branch whose routes exclude panel prefixes via `Route::where(...)` |
| Hydrate-auth 403s invisible / generic error toast only | `HttpException` in `internalDontReport` | `registerErrorNotification(statusCode: 403)` + `stopIgnoring` + Livewire-403 logging |
| App boots & panel crawl pass, but a feature fatals only when used; PHPStan `class.notFound`/`method.override` on an `App\Vendor\*` class | Vendor-shadow override `extends` a v4-moved/removed/now-enum parent (latent until instantiated) | Pattern 29: fix or delete the override + repoint every config map/binding referencing the old FQCN; wire the PHPStan gate so it cannot hide |
| PHPStan/Larastan reports suspiciously clean and misses v4 class/namespace moves | `@mixin \IdeHelper*` model annotations + a `scanFiles` `_ide_helper_models.php` directive in `phpstan.neon` blanket-mute findings (unresolved symbols assumed to live on the IdeHelper class) | Drop the `@mixin` annotations + `scanFiles` directive (or regenerate the ide-helper file) so real findings surface (Phase 5) |
| Bolt response-status dropdown/widget errors on `getEnum('FormsStatus')` (or config looks stale) | Bolt v4 moved `FormsStatus` Models -> Enums; app config still maps it under `models` and lacks the `enums` block | Add `config('zeus-bolt.enums').FormsStatus => \LaraZeus\Bolt\Enums\FormsStatus`, drop `models.FormsStatus`, delete the Sushi override (Phase 4 / Pattern 29) |
| `RouteNotFoundException: Route [login] not defined` (often only when a user is force-logged-out, e.g. a password change) | `bootstrap/app.php` `redirectGuestsTo(fn () => route('login'))` (Laravel/Shift default) but no route is named `login`; `AuthenticateSession` resolves it on forced logout, before Filament's panel auth runs | Point `redirectGuestsTo` at real routes: admin requests -> `route('filament.admin.auth.login')`, else the app's front-end login (e.g. `route('login_index')`) |
