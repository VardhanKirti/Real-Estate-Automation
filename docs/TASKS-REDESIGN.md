# Tasks — full page overhaul

Scaffold for replacing `/tasks`. Written 2026-09-17 from five references in
`~/Desktop/UI design examples/Tasks ui 1/`: two Syncro dashboard shots, two
Staffly calendar shots, one dark task-management shot.

Intent: clone the reference UI as closely as possible — button design, chart
design, card language — on our own type (Geist, not the references') and our
own tokens. Logic first, then UI.

---

## 0. The one reframe

All five references are **human team** tools. Their spine is people: avatar
stacks, "Workload overview" by person, "Total hours" worked, "28 Workers",
calendar grids for humans with calendars.

GladOS tasks are **agent work**. Port those tiles literally and every one of
them lies: an "Overdue" count against due dates nothing sets, "Total hours"
for agents that don't log time, a "People" table for a fleet with no people.

So: **keep every layout, re-derive every number.** The visual language is
adopted wholesale. The metrics are rebuilt on `agent_runs`, `agent_tasks` and
`agent_crons` — the substrate that already exists. Where no substrate exists,
the tile ships as an honest empty state with a *Set up* link, per the house
rule. Nothing renders a number it cannot source.

Working assumption (flag if wrong): `/tasks` holds **both** your own to-dos and
the fleet's work, because the references already model both — the left "To-Do"
rail is personal, "Assigned Tasks" is delegated. Delegating moves a task from
you to an agent. This mirrors how Wizard already behaves.

---

## 1. Reference inventory — every element, with a verdict

### 1a. Syncro (images 1 + 2)

| Element | What it does | Verdict |
|---|---|---|
| Left sidebar: Dashboard / Messages / My task / Calendar / People / Time tracking | app nav | **Drop.** We have a sidebar. Messages → Comms, Calendar → the board below, People → n/a, Time tracking → agent runtime |
| Workspaces switcher | multi-tenant scoping | **Remap → ventures.** Optional filter, phase 4 |
| Top bar: back chevron, title, avatar stack, Share | page chrome | **Drop avatars + Share** (single operator). Keep the title row |
| "Last 30 days" range pill | scopes every metric on the page | **Keep.** Drives all tiles. 7d / 30d / 90d / 12mo |
| Export (black filled, icon) | exports the view | **Keep.** CSV of the filtered task set |
| 4 stat cards: Total task / On progress / On hold / Total hours | headline KPIs with delta chip + caption | **Keep the form, remap 2.** See §3 |
| Task overview: Daily/Monthly/Yearly segmented, Pending vs Completed paired bars | volume over time | **Keep wholesale.** Best element in the set |
| "Bar chart" dropdown | chart-type switcher | **Keep**, bar / line only |
| My Schedule rail: month stepper, day strip, event cards | what's coming | **Keep the form.** Backed by crons + due dates — see §4 blocker |
| Workload overview table: Name, Assigned, Completed, On going, Pending, Department, Load level | who is loaded | **Keep, by agent.** Name → agent, Department is already real |
| Search + Filters | table controls | **Keep** |

### 1b. Staffly (images 3 + 4)

| Element | What it does | Verdict |
|---|---|---|
| Top nav: Dashboard / Calendar / Conversations / Timesheet / Insights | app nav | **Drop.** Conversations → Comms, Insights → Analytics, Timesheet → n/a |
| Search with ⌘+Space hint | global search | **Drop.** CommandPalette already owns this |
| Left "To-Do" rail: This week / This Month / Q4 goals / Personal, collapsible, checkboxes, "+ To-do" | personal list, grouped by horizon | **Keep wholesale.** This is the personal lane |
| 5 stat cards: Total / Assigned / Incomplete / Complete / Overdue | KPIs | **Merge with Syncro's strip.** One strip, not two |
| Calendar controls: month stepper, Columns, date, Filter, + New | board chrome | **Keep** |
| Week time-grid, dotted cells, 08:00–11:00 rows | when work happens | **Keep the form.** Blocked — see §4 |
| Task cards: gradient header block + white body, title, time range, avatar stack | the card | **Keep.** Gradient header carries the *department* colour; avatars → agent chip |
| "+ Add" on empty cell hover | inline create | **Keep** |
| "Free time" label | unscheduled slot | **Keep**, renamed *Idle* |

### 1c. Dark task management (image 5)

| Element | What it does | Verdict |
|---|---|---|
| Messages / Files / Report pills | nav | **Drop.** Files has no surface here |
| Dark/light toggle | theme | **Already exists** app-wide |
| Meetings and Boards, "Meeting with developers", "Next presentation / 18 Nov / Days left 07" | meetings | **Drop meetings.** Keep the **countdown tile** pattern for the next scheduled run |
| "Since last month, your meetings have grown 5%", First 4/8/16/21 days tabs, Success/Canceled chips, area chart | trend with outcome split | **Keep.** Retarget to run outcomes: Succeeded / Failed |
| **My Activity: 83%, +14%, hatched weekday bars with % at base, marker line, floating "9 tasks" pill** | weekly performance | **Keep wholesale.** You called this out specifically — §5 |
| Projects overview, 28 Workers, project card, avatar stack, Manage › | portfolio | **Remap → Departments overview.** Optional, phase 4 |

**Dropped because another page owns it:** Messages/Conversations (Comms),
Insights/Timesheet (Analytics), Files (none), global search (CommandPalette),
Share/Export-to-team (single operator), People/Workers/avatars (no humans in
the fleet).

---

## 2. Substrate audit — what we can actually source

Measured in `~/projects/glados/data/founder-os.db` and the demo, 2026-09-17.

| Table | Columns | Working | Demo | Written by |
|---|---|---|---|---|
| `agent_tasks` | id, agent_id, title, status(open\|doing\|done), created_at, updated_at | 14 | 8 | UI |
| `agent_runs` | id, agent_id, started_at, finished_at, ok, summary | **0** | 752 | `lib/agents/runtime.ts` |
| `agent_crons` | id, agent_id, schedule, description, enabled, created_at | **0** | **0** | nothing |
| `agents` | + department_id, tier, model, tools, parent_id, status | 22 | — | seed |
| `departments` | + color, slug, tagline | 6 | — | seed |

Three findings that shape everything:

1. **`agent_runs` carries `started_at`/`finished_at`/`ok`.** That is duration
   and success rate — enough for Total hours, My Activity, and the outcome
   trend chart, for free. Rich in demo (752 runs), empty in the working repo
   until agents actually run. Both are honest; the working repo shows an empty
   state until the mini is live.
2. **`agent_crons` is empty everywhere and `lib/cron.ts` has no runner** — it
   parses and describes cron expressions, nothing more. The calendar grid and
   the schedule rail have *no data source at all* today. This is the one real
   blocker.
3. **`agent_tasks` has four usable fields.** No body, no due date, no priority,
   no owner-that-isn't-an-agent. The references need all four.

`sop_tasks` (summary + `steps[]`) is the SOP layer for departments and stays
where it is. Not this page.

---

## 3. Data model changes

### 3.1 `agent_tasks` — extend

```
detail      TEXT NOT NULL DEFAULT ''     -- markdown body, the instruction
due_at      TEXT                         -- nullable ISO; Overdue counts only these
priority    TEXT NOT NULL DEFAULT 'normal'  -- low | normal | high
owner_kind  TEXT NOT NULL DEFAULT 'agent'   -- agent | me
horizon     TEXT                         -- week | month | quarter | someday
run_id      TEXT                         -- the agent_run that executed it
```

Status enum grows: `open | doing | blocked | done`. `blocked` is the honest
form of the reference's "On hold" — it means *waiting on you*, and the card
says what it's waiting for.

Back-fill with the `ALTER` pattern `lib/db.ts` already uses for older
databases. Every column has a default, so existing rows stay valid.

### 3.2 Derived, never stored

- **Load level** (Low/Medium/High pill) = open + doing tasks for that agent,
  banded against the fleet median. Recomputed per render, never written.
- **Activity %** = `ok` runs ÷ total runs, per weekday, over the range.
- **Agent runtime** = Σ(`finished_at` − `started_at`) over the range.

---

## 4. Page architecture

Five zones, top to bottom. Widths at the app's existing container.

```
┌──────────────────────────────────────────────────────────────────┐
│ PageHeader: "Tasks"        [Last 30 days ▾]          [Export ⭳]  │  Zone 0
├──────────────────────────────────────────────────────────────────┤
│ [Total] [In progress] [Needs you] [Agent runtime] [Overdue]      │  Zone 1
├───────────────────────────────────┬──────────────────────────────┤
│ Task overview                     │ My Schedule                  │
│  Daily|Monthly|Yearly  [Bar ▾]    │  ‹ February 2026 ›           │  Zone 2
│  ▉▉ paired bars, Pending/Complete │  01 02 03 04 05              │
│                                   │  ┌ next run cards ┐          │
├───────────────────────────────────┴──────────────────────────────┤
│ Board:  ┌ To-Do rail ┬ week time-grid ──────────────────┐        │  Zone 3
│         │ This week  │ dotted cells, gradient cards      │        │
├──────────────────────────────────────────────────────────────────┤
│ Workload overview (by agent)      │ My Activity (weekly %)       │  Zone 4
└──────────────────────────────────────────────────────────────────┘
```

Zone 0's range pill scopes **every** number on the page. One source of truth.

---

## 5. Component specs

Cloned close. Colours are tokens (`app/globals.css`) — no raw hex, per house
rule. The references' lavender maps to our mint accent; their per-card
gradients map to the department colour and the `--ramp-1..4` data ramp.

### 5.1 StatCard — `components/tasks/StatCard.tsx`

Syncro's card, exactly: 16px inline stroke icon + 12.5px label top-left,
`⋯` menu top-right, **40px tabular number**, delta chip inline to its right,
12.5px dim caption below.

- Delta chip: `rounded-full`, 11px tabular, up = accent-soft bg / accent text,
  down = danger-soft / danger. Arrow glyph, not an emoji.
- Five cards, not four: **Total · In progress · Needs you · Agent runtime · Overdue**
- `Needs you` replaces "On hold" (status `blocked`). `Agent runtime` replaces
  "Total hours", formatted `142h 40m`.
- `Overdue` counts only tasks with a `due_at`. Zero due dates set → the card
  reads `—` with "no due dates set", never `0`.

### 5.2 TaskOverviewChart — `components/tasks/TaskOverview.tsx`

The paired-bar chart, cloned. Per period: a **hatched light bar** (Completed)
behind, a **solid accent bar** (Pending) in front, both `rx=6` on the top
corners only. Gridlines at 0 / 45 / 90 / 135 / 180 equivalents, auto-scaled.

- Segmented control Daily / Monthly / Yearly: grey track, white active pill
  with a small shadow, pill **slides** between positions.
- Legend: solid dot = Pending, hatched swatch = Completed.
- `Bar chart ▾` dropdown: Bar / Line.
- Hatching is an SVG `<pattern>` at 45°, 3px stripe — defined once in defs.

### 5.3 ScheduleRail — `components/tasks/ScheduleRail.tsx`

Month stepper `‹ February 2026 ›`; 5-day strip with `‹ ›`, active day a filled
mint pill; below it, cards for what's scheduled: clock icon, time range,
duration in parens, agent chip, `⋯`.

**Blocked.** `agent_crons` is empty and has no runner. Ships as the honest
empty state — "No scheduled agent work" + *Set up* → `/agents`. Wire it the
day crons exist.

### 5.4 Board — `components/tasks/Board.tsx`

Two panes, Staffly's layout.

**Left, To-Do rail.** Collapsible groups by `horizon` — This week / This month /
Quarter / Personal — each a caret + coloured label, checkbox rows, `+ To-do`
at the foot of each group. Checking animates a strike-through and the row
settles out over 180ms.

**Right, week time-grid.** Columns Mon–Sun, today's column tinted, rows by
hour. **Dotted cell borders** (1px dashed, hairline token). Cards: a gradient
header block in the owning department's colour, white/surface body beneath
with title, time range, agent chip. Soft shadow, `rounded-lg-t`.

- Empty cell on hover reveals a centred `+ Add` button.
- An empty run of cells reads `Idle` in dim text.
- Chrome: `Columns ▾`, date button, `Filter ▾`, `+ New` (filled accent).

**Blocked** on the same crons problem for *scheduled* work. Tasks with a
`due_at` can populate it immediately — so the grid ships in phase 3 showing
due tasks only, and gains scheduled runs later.

### 5.5 WorkloadTable — `components/tasks/WorkloadTable.tsx`

Syncro's table, by agent: checkbox · Name (agent chip + sort arrows) ·
Assigned · Completed · On going · Pending · Department · Load level · `⋯`.

- Load level pill: Low / Medium / High, banded against the fleet median.
- Search input + `Filters` button above right.
- Numeric columns tabular, right-aligned. Row hover tints.

### 5.6 ActivityGraph — `components/tasks/ActivityGraph.tsx`

The dark reference's My Activity panel, cloned — the one you called out.

- `Weekly ▾` dropdown + `⋮`, big **83%-style percentage**, delta above it.
- Seven weekday bars, **hatched fill**, the % label at the **base** of each
  bar, not the top. Below-threshold days render their label in danger colour.
- The peak day's bar is lighter/highlighted.
- A horizontal marker line crosses at the peak with a dot, and a floating
  dark pill reads `N tasks`.
- Source: `ok` ÷ total runs per weekday from `agent_runs`.

### 5.7 OutcomeTrend — `components/tasks/OutcomeTrend.tsx`

"Since last month…" panel: headline sentence with the delta inline, tab row
(First 4 / 8 / 16 / 21 days), `● Succeeded` / `● Failed` chips, area chart
with a marker dot and tooltip. Sourced from `agent_runs.ok`.

---

## 6. Motion

All of it behind `prefers-reduced-motion`.

| What | How |
|---|---|
| Stat numbers | count up 600ms `ease-out`, 60ms stagger across the five |
| Bars | grow from baseline 500ms `cubic-bezier(.22,1,.36,1)`, 30ms stagger |
| Segmented pill | slides 220ms, `transform` only |
| Cards | hover lift `translateY(-2px)` + shadow, 160ms |
| Calendar cell | `+ Add` fades in 120ms on hover |
| Card drag | lifts, drops into cell with a 200ms settle (phase 5) |
| Marker line | draws left→right 700ms on mount |
| Checkbox | strike-through 180ms, row collapses 200ms |
| Row hover | background tint 120ms |

---

## 7. Honest empty states

Each is a real state, not a placeholder.

- **No runs yet** (working repo today): runtime, Activity and Outcome panels
  read "No agent runs yet" + *Set up* → `/agents`.
- **No crons**: schedule rail and scheduled-work layer as §5.3.
- **No due dates**: Overdue reads `—`, grid shows only what has a date.
- **No tasks**: board shows the create affordance, nothing else.

---

## 8. Build order

1. **Data model** — the six columns, the `blocked` status, back-fill ALTERs,
   schema + zod + `agentTasks` accessors, API. Tests.
2. **Zone 0 + 1** — range pill, Export, five stat cards. Real numbers or
   honest blanks.
3. **Zone 2 + 4** — Task overview chart, Workload table, Activity graph,
   Outcome trend. This is where the design language lands.
4. **Zone 3** — To-Do rail + week grid on `due_at` only.
5. **Crons** — define `agent_crons` rows and a runner, then light up the
   schedule rail and scheduled work in the grid. Separate project.

Phases 1–4 ship a complete, honest page. Phase 5 is the only part gated on
work that doesn't exist yet.

---

## 9. Open decisions

1. **Personal lane confirmed?** This spec assumes `/tasks` holds your to-dos
   *and* the fleet's work, with delegation moving a task between them.
2. **Font.** The app ships **Geist** (`app/fonts/Geist[wght].ttf` →
   `--font-sans`), not SF Pro; there is no SF Pro in the repo. Spec keeps
   Geist. Say if you want SF Pro actually swapped in.
3. **Which versions.** Written against `~/projects/glados`. Confirm this
   lands in the demo and the OSS snapshot too.
