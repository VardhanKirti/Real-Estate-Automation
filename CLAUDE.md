# FounderOS (on GladOS): project notes for coding agents

Read this first. Same rules apply to any agent (see AGENTS.md).

## What this is
A Next.js 14 (app router) + SQLite personal operating system. One database
(`lib/db.ts`, opened via `lib/data.ts`), typed with zod schemas in
`lib/schemas.ts`. Pages under `app/`, shared UI under `components/`, domain
logic and connectors under `lib/`. Tests are vitest (`tests/`), including
`smoke.test.ts` (every page renders) and `smoke-api.test.ts` (every GET route
answers 200).

FounderOS v3 is the GladOS codebase plus two things of its own:
- `founderos/`: the FounderOS v1 Agents board and Social pages (`app/agents`,
  `app/social`) and the UI they need. They read GladOS's database and
  connectors; nothing in `founderos/` has its own data layer.
- `lib/demo/`: the demo company. A fresh clone runs in demo mode (Filming, in
  GladOS's words) and `lib/demo/store.ts` builds `demo-data/` from it on first
  start. Demo rows never go into `data/`.

## Project board
`docs/PROJECTS.md` is the live board of what is being built here, its
state, and what each step is waiting on. Read it at the start of every
session, right after this file. Update it before the session ends whenever
a step changes state, a blocker clears, or a new project starts. Absolute
dates only. Its `## Checklist` section is rendered under the terminal input by
the status line: keep it in sync with the tables (tick items when done, add
new ones, `!` prefix = waiting on the operator). Multi-step projects have a folder
under `docs/projects/<name>/` with `TASKS.md`; when the operator picks a project,
read its folder first and brief them from it. Shipped projects move to
`docs/projects/_done/`, never deleted.

## House rules
- **Honest or absent.** No placeholder metrics, fake "connected" states, or
  demo text dressed as real data. An unconfigured integration shows a
  *Not configured* badge and a *Set up* link (`SetupLink` / `setupHrefFor`;
  `tests/setup-links.test.ts` enforces it).
- **Never commit secrets.** Only `.env.example` is tracked. Keys are read
  through `lib/creds.ts`.
- **No emojis in UI.** Inline stroke icons only.
- **Every colour is a token** in `app/globals.css`; no raw hex in components.
- Keep the seed structural (`lib/seed.ts` seeds departments only): real data
  (`data/`) starts blank. Demo content belongs in `lib/demo/` and only ever
  reaches `demo-data/`.
- Run `npm test` and `npm run typecheck` before claiming a change works.

## Env
`GLADOS_DEFAULT_MODE` (`demo` unless set to `real`: what a fresh clone opens
on), `GLADOS_DB` (db path), `GLADOS_HOST` (bind address; loopback until a password
exists), `GLADOS_PASSWORD_HASH` + `GLADOS_SESSION_SECRET` (written by Setup →
Security, never hand-set),
`BRAIN_PROVIDER` / `GBRAIN_BIN` / `GBRAIN_STORE` (brain), plus connector keys
listed in `.env.example`.
