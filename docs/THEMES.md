# GladOS appearance: styles, accents, modes

Updated 2026-10-13 (FounderOS UI merge, `docs/projects/founderos-ui/SPEC.md` §2.5;
first written 2026-10-09 for GladOS UI S00). The model lives in
`lib/appearance.ts`; the server reader is `lib/appearance-server.ts`, the React
hook `lib/use-appearance.ts`. There are **three styles**:

| Style (`data-ui`) | Label users see | Colour axis | Mode | Tokens | Font | Widget tree |
|---|---|---|---|---|---|---|
| `glados` | `BRAND.name` (GladOS on the private build, FounderOS on the client build) | accent `ice`, `lime`, `ember`, `mint` | `dark`, `light`, `system` | `--g-*` | Geist | GladOS tree on routes in `G_READY` (`lib/g-ready.ts`), else the Classic tree in a derived Classic theme |
| `classic` | Classic | theme `console`, `red`, `light` (White), `frost`, `grey-frost` | follows the theme | `os-*` (`--bg`, `--surface`, ...) | Geist + Geist Mono | Classic tree everywhere |
| `legacy` | Bennett Legacy | skin `mono`: Monolith (dark) and Daylight (light) by mode | `dark`, `light`, `system` | `--l-*`, plus the Classic tokens remapped under `data-theme='monolith'` / `'daylight'` | JetBrains Mono (bundled, `app/fonts/`, OFL) | Legacy tree (`components/legacy/*`) on routes in `L_READY` (`lib/l-ready.ts`), else the Classic tree under the Legacy skin inside the `LegacySlab` frame |

`treeFor(appearance, pathname)` (`lib/appearance.ts`) picks `'glados' | 'legacy' | 'classic'`
for every page fork. Legacy trees exist for `/trading`, `/usage`, `/clients`,
`/lead-magnets`, `/chats`, `/wizard`, `/login` and the seven `/lab` routes
(plus the `/dev/l-kit` specimen, dev only). Full-height workspaces
(`L_NO_SLAB`: `/workflows`, `/wizard`, `/blueprint`, `/inbox`,
`/creative-engine`, `/brain`, `/login`, `/chats`) render without the slab.

So the GladOS style has 4 accents × 2 modes = 8 looks, Classic 5 themes, and
Bennett Legacy 2 faces (Monolith, Daylight). Dark GladOS is always the grey
Creative Engine ground, never black (Q-SYS-3). Monolith is FounderOS v1's
black (`--l-bg: #0a0a0a`); Daylight its light face. Terminal, Clay, Midnight and
Ember skins would join `LEGACY_SKINS` only if Brody asks (SPEC T2).

Legacy contrast rule (O8): `--l-text-3` (about 3:1) is for non-essential text
only and must carry `data-l-decor` or `aria-hidden`; captions use
`--l-text-2`. Under the skin, Classic's `--text-3` maps to `--l-text-2`, and
text that Classic sets in a data hue reads a `--ramp-N-ink` token (defined
only under Monolith and Daylight, the ramp is the fallback), so Classic and
GladOS are unchanged. `scripts/l-audit.mjs` enforces 4.5:1 (3:1 for large text).

## How to switch

Settings → Appearance (`/setup`, the first section; `components/AppearancePicker.tsx`,
and `components/legacy/AppearanceLegacy.tsx` under Bennett Legacy).

1. **Style**: {BRAND.name} | Classic | Bennett Legacy, one click each way.
   Switching refreshes the page so server components render the matching tree.
2. **Colour**: under GladOS the four accent swatches; under Classic the five
   theme cards; under Bennett Legacy the skin (Monolith/Daylight swatch).
3. **Mode**: Dark | Light | System under GladOS and Bennett Legacy (under
   Legacy, Dark is Monolith and Light is Daylight). Hidden under Classic.

Colour and mode apply instantly without a reload. `?mode=dark|light` on any
URL forces the mode for one load (screenshots, audits) and is never stored.

## Storage and first paint

- Cookie `glados-appearance` = `<ui>.<accent-or-skin>.<mode>` (for example
  `glados.ice.dark`, `legacy.mono.light`, `classic.ice.dark`; 1 year,
  `SameSite=Lax`), mirrored in `localStorage` `glados-ui`, `glados-accent`,
  `glados-mode`. Classic keeps its theme in `glados-theme` and Legacy its skin
  in `glados-legacy-skin`, so switching styles back and forth never loses any
  style's choice (checked in a browser 2026-10-13: Ember survives
  GladOS → Legacy → Classic → Legacy → GladOS).
- `app/layout.tsx` reads the cookie on the server and renders
  `<html data-ui data-accent data-mode-pref data-mode data-theme>`; under
  Legacy `data-theme` is `monolith` or `daylight`. The head init script only
  resolves `system` and migrates legacy storage. No flash.
- The Creative Engine's own Light/Dark button and its `ae-mode` key are gone.
  A stored `ae-mode` is deleted on load and never promoted to the app mode.

## Defaults

- **Fresh install, private build** (`GLADOS_BRAND=glados`): GladOS · Ice · Dark.
- **Fresh install, client build** (FounderOS brand, no `GLADOS_BRAND`):
  Bennett Legacy · Monolith · Dark (`defaultAppearanceFor`, SPEC T1 default).
- **Existing install** (a stored Classic theme, no appearance cookie): stays
  Classic until the operator switches. A stored choice always wins.

## Old theme → new look

When an install that used a Classic theme picks the GladOS style, its old
theme seeds the accent and mode (`migrateLegacy`, FR-6):

| Classic theme (`glados-theme`) | GladOS accent · mode |
|---|---|
| Console | Lime · Dark |
| Red | Ember · Dark |
| White (`light`) | Lime · Light |
| Frost | Ice · Dark |
| Grey Frost | Ice · Dark |
| none stored | Ice · Dark |

## Rollout: converted and unconverted pages

A route listed in `G_READY` (`lib/g-ready.ts`, 35 routes on 2026-10-13, every audited route)
renders its GladOS widget tree under the GladOS style. Any other route renders
its Classic tree under a Classic theme derived from accent and mode
(`deriveClassicTheme`, FR-3), so it still looks coherent:

| GladOS accent · mode | Classic theme used for unconverted pages |
|---|---|
| any · Light | White |
| Ice · Dark | Grey Frost |
| Ember · Dark | Red |
| Lime or Mint · Dark | Console |

Settings shows an honest line while this lasts ("{n} of {m} pages use the new
widgets; the rest keep Classic widgets in your colours", `lib/g-rollout.ts`).
It hides itself once every route converts. Under the Classic style every route
is byte-for-byte the Classic look.

## Tokens

- Every GladOS colour is a `--g-*` token in `app/globals.css`. Each accent has
  a dark block `:root[data-ui='glados'][data-accent='<id>']` and a light block
  `…[data-mode='light']`, including hero gradients `--g-hero-a|b|c` with their
  `-ink` and chart series `--g-series-*`.
- JS palettes (`lib/use-palette.ts`) read the accent's `--g-series-*` from
  computed style under GladOS and the Classic theme palette under Classic; they
  re-read on any change to `data-ui`, `data-accent`, `data-mode`, `data-theme`.
- Widgets come from the kit in `components/g/*`; each carries `data-g="<Name>"`.
  A converted route uses no Classic control (`tests/g-controls.test.ts` plus the
  runtime guard in `scripts/g-audit.mjs --controls`).
- `scripts/g-audit.mjs --glados` checks contrast, accent-coloured shadows and
  hero count per accent, mode and width.

## Bennett Legacy

The third style reproduces Bennett's FounderOS look (v2 `main` tokens, pinned to v1).
Kit: `components/legacy/*` (Slab, SlabTitle, SlabCard, Chip, Badge, Dot, BigStat,
MeterStack, StepLine, DotMatrix, InsightCard, Pressable, ToggleChip, Kbd,
ConductorEmblem, OsMark, and the Empty, Unconfigured, Error, Skeleton and Sample
states); every element carries `data-l="<Name>"`. Shell: FO lockup (OsMark +
`BRAND.name`), group labels, footer strip and topbar (`components/legacy/Shell.tsx`).
Not reproduced from FO: the cursor spotlight, the cohort pop-up and footer CTA,
FO's broken 390 px layout, hard-coded "FOUNDER OS" text. Tokens: the `--l-*`
block and the L0 to L2 blocks near the end of `app/globals.css`.

Audit: `node scripts/l-audit.mjs --routes <list> --skins monolith,daylight --widths 1440,1024,390`
checks appearance, text contrast, 0 GladOS kit classes in Legacy DOM, no
horizontal scroll, one slab per non-workspace route and the JetBrains Mono
body; its GladOS pass checks 0 Legacy classes in GladOS DOM. Run 2026-10-13
(P6, Filming world, 43 routes × 2 skins × 3 widths): clean after the fixes
listed in `docs/projects/founderos-ui/BUILD-REPORT.md` §5.

## Classic is kept

Classic stays a permanent option through the rollout (Q-SYS-2). Whether to
retire it is Brody's call after review; retirement is one change. Everything
below documents the Classic style.

---

## Classic style

Five colourways ride `data-theme` on `<html>`: **console** (default), **red**,
**light** (named "White" in the picker), **frost** and **grey-frost**. Under the
Classic style the picker is the Colour row of Setup → Appearance
(`components/ThemePicker.tsx`); the choice is stored under `glados-theme` and
applied before first paint by `APPEARANCE_INIT_SCRIPT` (`lib/appearance.ts`,
injected in `app/layout.tsx`; it replaced `THEME_INIT_SCRIPT` on 2026-10-09).

### The contract

- Every colour in the UI is a token in `app/globals.css`. A theme is a block of
  token overrides: the root set (`:root[data-theme='…'] { --bg … --accent … }`)
  plus the per-feature blocks that follow the same pattern (`--bh-*` blueprint,
  `--ib-*` and `--cx-*` inbox, `--fc-*` funnel, `--life-*` life areas,
  `--wf-*` workflows, `--ae-*`/`--p-*` Creative Engine; `ae` = creative engine, historical prefix).
- Colours that live in JS (chart series, channel identities, skill pearls,
  the observatory lobes) come from `lib/use-palette.ts`, one `Palette` per
  theme, read live through `usePalette()`.
- Status stays honest in every theme: `--ok`, `--warn`, `--err` carry meaning
  with a dot and a word; the hue only assists. Under Red the ok hue is orange,
  under Frost and Grey Frost it is cyan, so nothing green survives in those three.
- No text shadows anywhere outside the Creative Engine's own paper surface.
- Sanctioned exceptions: AdPilot keeps its red signal in every theme (its
  ground and surfaces follow the theme via `[data-adpilot]` tokens, and its
  signal turns Frost blue under Frost and Grey Frost); the Creative Engine
  keeps its own paper surface, dark by default, with its green and lime
  re-keyed under Red, Frost and Grey Frost.

### White (`light`)

Paper ground `#f4f5f7`, white cards, graphite ink `#15171a`, the signal mint
held back to `#0a8f63` so it reads on white. Shadows are soft and grey,
glass is white-translucent, the data ramp is the same blue→violet family at
readable depths. Dark scrims and modal backdrops stay dark. `color-scheme:
light` so native controls follow.

### Frost (`frost`)

The sidebar's blue-white hover made into a whole theme: ground `#06080c`,
ice ink `#eaf4ff`, signal `#9fc6ff`, and a soft blue-white glow on cards,
the active nav item, popovers and primary buttons (`--glow` is live here;
Console stays matte). Every data hue is blue-white, status ok is cyan.

### Grey Frost (`grey-frost`)

Grey Frost = Frost signal + grey ground. Every Frost rule is written as a
paired selector, `:root[data-theme='frost'], :root[data-theme='grey-frost']`,
so the accent, status, data hues, glows and hover effects are shared by
construction: editing a Frost rule changes both themes on purpose. Right
after each shared family a `:root[data-theme='grey-frost']` block overrides
only ground, surface, line, ink and shadow values (root, Blueprint `--bh-*`,
Funnel `--fc-*`, Inbox `--ib-w-*`, convex `--cx-*`, the Creative Engine dark
paper, the Motion console window, the AdPilot ground). A new token family
follows the same pattern from day one (SPEC §5 C17);
`tests/theme-tokens.test.ts` fails on any gap.

| Role | Value |
|---|---|
| Ground `--bg` / sidebar `--bg-2` | `#18191d` / `#131417` |
| Card / chip / hover `--surface` 1-3 | `#1f2126` / `#272a30` / `#30333a` |
| Lines | `--border #2c2f36`, `--border-strong #3d414b`, `--hairline #23252b` |
| Ink | `--text #ecf2fa`, `--text-2 #a8b2c1`, `--text-3 #8b94a3` |
| Signal (shared with Frost) | `--accent #9fc6ff`, ok `#6ee7ff`, warn `#ffd166` |
| Own | `--err #ff6b78`, `--glow` at 0.42, softer `--shadow-pop`, a cool-neutral `.bg-os-surface` sheen |

Contrast (WCAG 2.x, recomputed from the CSS by `tests/grey-frost-theme.test.ts`):
`--text` 15.6:1 on the ground, `--text-2` 8.2:1, `--text-3` 5.7:1; every text
token is at least 4.5:1 on `--bg`, `--bg-2`, `--surface`, `--surface-2` and
`--elevated`, and the paper ink on the engine cards. The G-Brain stages and
HUDs, the g-brain ask pill and the Knowledge panel read `--viz-*`,
`--gbr-pill-bg` and `--kg-panel-bg`, so Grey Frost lifts them onto the grey
instead of leaving near-black holes.

### Page grounds

A page ground is painted by `html`/`body` or by a fixed full-viewport
`.page-ground` layer, never by a box sized to the content, so no ground ever
stops short of the scroll end. The Creative Engine's dark paper ground is
the OS ground (`--os-bg`, declared on `:root` only); White has no black, so
forced Dark there uses `--ae-dark-ground`. AdPilot's solid ground is a
`.page-ground`; its dot grid cancels `main`'s padding. `scripts/ground-check.mjs`
checks the bottom of every route in every theme at 1440 and 2200 wide.

### Audit

`scripts/theme-audit.mjs` drives a headless Chrome over DevTools: for every
route × theme it sets the theme before paint, screenshots the page, and scans
every visible element's computed colour, background, border, shadow and svg
fill for green-family colours, splitting them into **literal** (not the value
of any token) and **token-derived**. Both must be 0 in Red, Frost and Grey
Frost; in Console and White, whose signal is green, they are reported, not
failed. It also lists every `text-shadow`. Run it after any colour change.
Themes default to every id in `lib/theme.ts` and routes to the 28 in
`scripts/audit-routes.mjs`; every non-GET `/api` request is blocked, so an
audit never spends credits. The script exits non-zero on a failure; Setup
(picker swatches) and Integrations (third-party brand marks) are sanctioned.

First full run, 2026-10-02, 30 routes × 4 themes: Red and Frost report zero
greens of either kind on every page. The only hits left anywhere are by
design: the theme picker's own swatches on Setup, brand marks on
Connections (WhatsApp, Beehiiv), the Creative Engine's paper palette under
Console and White, and `rgb(... / a)` triplet tokens such as
`--live-badge-rgb`, which the detector cannot trace back to a token.
`scripts/theme-hover-check.mjs` covers hover states and the live switch
on the picker (every card sets `data-theme` and `aria-pressed`) and checks
the shared Frost glow under Frost and Grey Frost; no text shadow appears in
any theme. `scripts/ground-check.mjs` samples the bottom of every route
(see Page grounds) and, under Grey Frost, flags near-black regions larger
than 200x200 that are not media or dialogs.

Run 2026-10-08 (Grey Frost, SPEC S06 Phase 2), 30 routes × 5 themes,
filming data:

- `theme-audit`: Red, Frost and Grey Frost report 0 token greens on every
  route and 0 literal greens outside Setup, Integrations and `/personas`.
  `/personas` carries literal Console mint (`#00ffab`) in all three; the page
  is removed by SPEC S12, so it is listed as known, not fixed here (it was
  removed the same day; the 2026-10-09 run below has no such exception). Grey
  Frost matches Frost exactly. No text shadow in any theme.
- `ground-check` at 1440 and 2200: every sampled bottom pixel is the page
  ground or covered by content (Inbox triage column, Blueprint canvas, the
  Motion console window) in all five themes; no near-black hole under Grey
  Frost. It found the closed Wizard dock casting its popover shadow down the
  right edge of every page under White (now off while closed).
- `theme-hover-check`: the shared blue-white glow on the sidebar hover and
  the `.hoverable` cards under Frost and Grey Frost; every picker card applies
  its theme and sets `aria-pressed`.

Run 2026-10-09 (UI polish Phase 4, one merged Filming build with paid keys
masked, 28 routes × 5 themes; `/personas` and `/reference` are gone):

- `theme-audit`: PASS. Red, Frost and Grey Frost show 0 token greens and
  0 literal greens everywhere except the sanctioned brand marks and swatches
  on `/integrations` and `/setup`. No text shadow in any theme.
- `ground-check` at 1440 and 2200: PASS in all five themes. Its 25 notes are
  spots covered by content (Inbox triage column, Motion console window,
  Blueprint canvas), not cut-offs.
- `screenshot-matrix` (§10.2 of the UI polish spec; 28 routes × 5 themes ×
  1440/1024/390, 420 cases): no overlaps, no errors, 0 non-GET requests. Its
  one finding, `/funnel` scrolling sideways at 390 under Console and Red,
  was fixed (the ask bar's typing line is clipped to its box).
- The Creative Engine, AdPilot and Motion console click audits passed on the
  same build (`scripts/creative-engine-audit/click-audit.mjs`,
  `scripts/motion-console-audit.mjs`).

Same day, after the rename (Phase 5): the audits read the engine at
`/creative-engine`; `/ad-engine` 308s there.

### Motion console

The console (`/creative-engine?engine=console`, `.ae-octane`) was built to the
Octane reference and carries its own `--o-*` palette. Since 2026-10-02 it
follows the OS theme: every surface, chrome and signal is an `--o-*` token
(the literal fills, the selection ring, the node icon plate, the slider
thumb, the scrims and the drop shadows included) and three override blocks
re-key it. Red keeps the deep reds and turns every green and purple warm.
Frost turns the window cool black, the red signal Frost blue, the green
readouts cyan. Grey Frost shares Frost's signal on a grey window (`#18191d`,
panels `#1f2126`). White is a light window with graphite ink and every signal
held back. The one text shadow (reference tile labels) is now a scrim
gradient. The lighting and style swatches depict real light and film looks,
so they stay literal on purpose. Audit: Red and Frost report zero greens.

Sanctioned exceptions: the `/design/*` study pages are pinned specimens of
one style and keep their own surface in every theme; the Globe and the
AdPilot deck keep their red signal.
