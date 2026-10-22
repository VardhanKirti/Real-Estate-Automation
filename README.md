# Real Estate Automation

**An AI agent control center for a real estate business — built on top of the [Skyescraper](https://github.com/) CRM, with four specialist agents that actually read and write real data, not demo data.**

This isn't a chatbot bolted onto a dashboard. It's a working operator console where every number on screen comes straight from the real estate CRM's database, and every agent you talk to can genuinely look things up and make changes — update a lead's stage, mark a unit sold, publish a project, log a site visit — through the CRM's own API, so nothing bypasses the validation and permissions the business already relies on.

## What it actually does

Four agents, each built for a specific job, each with real memory of the conversation and a real toolset:

| Agent | What it's for |
|---|---|
| **Lead Management** | Reading and updating leads — stage changes, agent assignment, logging activity and notes |
| **Property Inventory** | Unit and project status — marking units sold/available, publishing or unpublishing projects |
| **Property Intelligence** | Read-heavy analysis across projects and leads — the agent you ask "what's our best-performing project this month" |
| **Client Care** | Lead and project notes, reminders, and the day-to-day admin that otherwise falls through the cracks |

Every agent:
- Talks over a chat interface, with real conversational memory per session
- Can read the CRM database directly (through a **read-only** database user — it can look things up, but a write only ever happens through the CRM's own API, where the app's own rules still apply)
- Is visible everywhere an agent should be: the agent roster, the health/status page, the chat list, its own workflow canvas, and its own skills/playbook page
- Never claims a write succeeded unless the system it called actually confirmed it — this was tested by deliberately breaking things and checking the agent didn't lie about it

## The dashboard

The home dashboard shows **live** data — leads, properties, and the brokers derived from them — fetched from the real CRM, not sample data. It's wired through a shared caching layer so pages load fast even as the app grows, with the data pre-warmed the moment the server starts.

## How it's built

- **Frontend / operator console**: Next.js 14, SQLite for local app state
- **Agents**: run in [n8n](https://n8n.io) (self-hosted), each as a webhook-triggered workflow — an AI Agent node (Claude), a scoped MySQL read tool, and one or more HTTP tools that call the CRM's real API
- **CRM**: a Laravel application (Skyescraper) — all writes go through its REST API with a Sanctum bearer token, so every write obeys the CRM's own validation and roles
- **Caching**: every live read goes through one stale-while-revalidate cache (30s fresh, background refresh after), pre-warmed at boot — not a dashboard that waits on a third-party API every time someone opens it

## Running it yourself

Requires Node 22+.

```bash
npm install
npm run dev                    # http://localhost:4100
```

You'll need a few things in `.env.local` (see `.env.example`) before the agents and live data come alive:

- `SKYESCRAPER_API_URL` / `SKYESCRAPER_API_TOKEN` — your CRM's API base URL and a bearer token
- `SKYESCRAPER_N8N_*_WEBHOOK` — the webhook URL for each n8n agent workflow
- `GLADOS_BRAND=realestate` — switches the console's name and logo to Real Estate Automation

Without those, the app still runs — it just shows honest "not configured" states instead of fake numbers.

Warm up every page and API route after a restart (so the first real visit isn't the one paying the compile cost):

```bash
node scripts/warm-local.mjs --base http://127.0.0.1:4100
```

## A note on where this came from

This project started from the open-source [FounderOS](https://founderos.sh) / GladOS operator-console template — the general-purpose "run your business from one screen" shell — and was then built out specifically for a real estate business: real agents, a real CRM, real data, nothing left as a demo. The original template's MIT license is kept in [`LICENSE`](./LICENSE).
