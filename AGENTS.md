# FounderOS (on GladOS): agent rules

Full project notes live in **CLAUDE.md** (same directory) — read it first.
This file exists so non-Claude agents (Codex, etc.) get the same house rules.

## Non-negotiables
- **Never commit or copy secrets.** Credentials live in `.env.local`
  (gitignored); `lib/creds.ts` resolves them.
- **Never push to a remote without the operator's explicit yes.** Commit
  locally, small checkpoints, often.
- **Honest or absent.** Nothing in the UI may claim a state the system is not
  actually in.
- **Tests before claims.** `npm test` and `npm run typecheck` must pass.
