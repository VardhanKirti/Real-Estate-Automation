# Content page — archived 2026-09-17

The `/content` page (the studio composer: schema-driven model picker, identity,
pipelines, queue) was taken off the live app on 2026-09-17. The operator's call:
"not useful at the moment". The architecture stays; only the route is gone.

## What is still live
- `lib/content*.ts` — schema, composer spec, pipelines, production, queue, uploads
- `components/content/` — the composer and its panels
- `app/api/content*` routes and the DB tables they read
- Tests for all of the above

## What this folder holds
`page.tsx` is the route file exactly as it was, moved out of `app/` so Next
does not serve it. It still type-checks against the live libraries.

## To restore
1. `git mv archive/content-page/page.tsx app/content/page.tsx`
2. `lib/nav.ts`: add `{ href: '/content', label: 'Content', icon: Clapperboard }` back to NAV_OPERATE after Social (and the Clapperboard import)
3. `lib/blueprint/compile.ts`: add `'/content': 'clapperboard'` to SURFACE_ICON and `'/content': ['store-queue', 'store-pipelines']` to SURFACE_STORE_EDGES
4. `components/adpilot/AdLibrary.tsx`: bring back the Remake button (`router.push('/content?remake=1')` with the `glados:remake` sessionStorage payload)
5. Tests: re-add the smoke entry, the nav digit regression for `/content`, and the blueprint surface→store assertions

Every step above is the inverse of commit "Content: retire the page, keep the architecture".
