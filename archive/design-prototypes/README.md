# Design prototypes — archived 2026-10-09

The five `/design/*` routes were prototype pages from earlier design rounds.
They were taken off the live app on 2026-10-09 (GladOS UI spec S05 F05.110,
honesty fix H36). They now return 404.

| Route | Why it was archived |
|---|---|
| `/design/console` | Style demo with layout sample metrics (approve, skip and run numbers), which breaks the honest-or-absent rule. It also loads its own font and CSS. |
| `/design/home-6` | Rendered `Home6Console`, the same component `/` renders. A duplicate of Home. |
| `/design/gbrain-3` | Rendered `GBrainRadial`, the same radial `/brain` renders. A duplicate. |
| `/design/gbrain` | Losing variant: the flat constellation (`GBrainObservatory`). |
| `/design/gbrain-2` | Losing variant: the three.js 3D core (`GBrainCore3D`). |

The constellation and 3D core drew a second and third picture of the same
brain-store folders with no added function, so they are archived, not restyled.

## What is still live
- `components/Home6Console.tsx` (Home uses it)
- `components/GBrainRadial.tsx`, `components/GBrainRadialLazy.tsx` (`/brain` uses them)
- `components/gbrain-live.ts` and `lib/gbrain-observatory.ts` (the radial and Home read them)
- The `three` dependency stays in `package.json` until someone removes it on purpose.

## What this folder holds
- `<route>/page.tsx`: each route file as it was, moved out of `app/` so Next
  does not serve it.
- `components/`: the components only these routes used
  (`GBrainObservatory`, `GBrainObservatoryLazy`, `GBrainCore3D`,
  `GBrainCore3DLazy`, `GBrainVariantSwitch`). Their imports of each other point
  at `@/archive/design-prototypes/components/…` so the folder still type-checks
  against the live libraries.
- `console/page.tsx` loads its font with a path relative to `app/design/console/`;
  that path only resolves again once the file is back in `app/`.

## To restore
1. Move the routes back: `git mv archive/design-prototypes/<route>/page.tsx app/design/<route>/page.tsx`
   (create `app/design/<route>/` first) for each route you want.
2. Move the components back: `git mv archive/design-prototypes/components/*.tsx components/`
3. Point the imports back at `@/components/`:
   `sed -i '' "s#@/archive/design-prototypes/components/#@/components/#g" app/design/*/page.tsx components/GBrain*Lazy.tsx`
4. Tests: re-add the five smoke entries in `tests/smoke.test.ts`, the
   `['/design/console', null]` case in `tests/nav.test.ts`, and point the four
   viz-stage files in `tests/page-ground.test.ts` back at `components/`.

Every step above is the inverse of commit "Archive the /design/* prototype routes".
