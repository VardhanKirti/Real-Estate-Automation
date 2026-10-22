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
- Reads and writes exclusively through the CRM's own REST API — no direct database access, no credential beyond the CRM's own bearer token, so the app's own validation and permission rules always run
- Is visible everywhere an agent should be: the agent roster, the health/status page, the chat list, its own workflow canvas, and its own skills/playbook page
- Never claims a write succeeded unless the system it called actually confirmed it — this was tested by deliberately breaking things and checking the agent didn't lie about it
- Runs **in-process**, inside this same Next.js app — not as a separately-hosted workflow — so there's nothing extra to keep running or exposed publicly when this deploys anywhere

## The dashboard

The home dashboard shows **live** data — leads, properties, and the brokers derived from them — fetched from the real CRM, not sample data. It's wired through a shared caching layer so pages load fast even as the app grows, with the data pre-warmed the moment the server starts.

## How it's built

- **Frontend / operator console**: Next.js 14, SQLite for local app state
- **Agents**: [LangGraph.js](https://langchain-ai.github.io/langgraphjs/)'s `createReactAgent`, running in-process — Claude as the model (direct Anthropic API), a real tool per CRM action, and this app's own conversation history replayed on each turn (see `lib/agents/sky-agents.ts`, `lib/agents/langgraph-runner.ts`)
- **CRM**: a Laravel application (Skyescraper) — every read and write goes through its REST API with a Sanctum bearer token, so every action obeys the CRM's own validation and roles (`lib/agents/skyescraper-api.ts`)
- **Caching**: every live read goes through one stale-while-revalidate cache (30s fresh, background refresh after), pre-warmed at boot — not a dashboard that waits on a third-party API every time someone opens it

This started as four separately-hosted [n8n](https://n8n.io) workflows (one per agent). They were rebuilt on LangGraph.js and moved in-process specifically so the whole app — agents included — can deploy as a single Next.js app (e.g. on Netlify) with no second always-on service to host and expose publicly.

## Running it yourself

Requires Node 22+.

```bash
npm install
npm run dev                    # http://localhost:4100
```

You'll need a few things in `.env.local` (see `.env.example`) before the agents and live data come alive:

- `SKYESCRAPER_API_URL` / `SKYESCRAPER_API_TOKEN` — your CRM's API base URL and a bearer token
- `ANTHROPIC_API_KEY` — powers the four LangGraph agents directly
- `GLADOS_BRAND=realestate` — switches the console's name and logo to Real Estate Automation

Without those, the app still runs — it just shows honest "not configured" states instead of fake numbers.

Warm up every page and API route after a restart (so the first real visit isn't the one paying the compile cost):

```bash
node scripts/warm-local.mjs --base http://127.0.0.1:4100
```

## A note on where this came from

This project started from the open-source [FounderOS](https://founderos.sh) / GladOS operator-console template — the general-purpose "run your business from one screen" shell — and was then built out specifically for a real estate business: real agents, a real CRM, real data, nothing left as a demo. The original template's MIT license is kept in [`LICENSE`](./LICENSE).
