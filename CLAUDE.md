# CLAUDE.md — Project Instructions
# Project Name: EvolveRun (adaptive performance OS for endurance athletes)

## ⚠️ Local dev & verification — READ FIRST (hard rule)

**Never start a local dev server on this machine.** Running `npm run dev`,
`next dev`, `vercel dev`, or the preview MCP (`preview_start`) has **repeatedly
crashed the founder's Mac** (Turbopack pins CPU/RAM, especially when it hits a
stale-cache error loop). This is not negotiable — do not start one "just to
check", and do not leave a background dev process running.

Verify changes the lightweight way instead:
- **Types**: `cd frontend && npx tsc --noEmit`
- **Lint**: `cd frontend && npm run lint`
- **Tests**: `cd frontend && npx vitest run` and `cd backend && ./.venv/bin/python -m pytest -q`
- **Visual**: build a **static widget preview** (the `visualize` tool) to show UI
  changes in-chat — no server needed.
- **Real visual/behaviour confirmation happens on the deployed site
  (https://evolverun.app), never a local server.** Ship, then check in the browser.

If a change genuinely can't be verified without running the app, say so and let
the founder run it — don't start the server yourself.

**Every frontend change must look good on mobile, not just desktop.** Most
EvolveRun users check the app on their phone. When building or editing UI,
design and check the mobile viewport (~375px) alongside desktop — don't ship
something that only looks right at a wide breakpoint. On the deployed site,
verify with the browser's device toolbar / narrow window, or (in an
Artifact/widget preview) resize to a mobile width before calling it done.

## Mission (Version 1)

**Simple AI endurance coach. Connect Strava. Get answers.**

V1 ships as a single-purpose product: a hosted MCP connector that lets
Claude.ai / ChatGPT / Gemini answer questions about a runner's actual
Strava data, plus a thin web app for billing, onboarding, and viewing
the AI-generated training plan.

We deliberately do NOT in V1:
- Run our own LLM (the chat assistant does the reasoning)
- Integrate Garmin / Oura / Whoop / Polar directly (Strava is the aggregator)
- Build daily briefings or daily-adapter features (rejected by founder)
- Compete on dashboards or unified-health graphs

We DO in V1:
- Strava OAuth + webhook + 1-year initial sync + live updates
- 11 MCP tools (Chirona-parity, kebab-case) exposed via streamable HTTP
- Coaching-guide tool that locks tone, response shape, and plan grid format
- `save-training-plan` as the single atomic plan-write tool
- Hosted OAuth 2.1 + PKCE so claude.ai's "Add custom connector" → Connect
  flow works end-to-end
- Marketing landing page (`/`) → signup funnel: **signup → confirm email →
  `/onboarding` (connect Strava *before* paying) → hard paywall → `/dashboard`**.
  Non-payers stay dormant (data persists, dashboard locked by the middleware
  paywall). Onboarding shows only the *quantity* of synced history, never the
  analysis — that's the reason to subscribe.
- **Stripe Checkout subscription, now LIVE** — Pro Monthly €7.99/mo or Pro Annual
  €69/yr (no free tier). Price tags render live from Stripe (`GET /billing/prices`).
  `FOUNDER` promo (100% off forever, capped at 5 uses) comps the founder + tests.
- (5-question onboarding wizard rolled back — deferred to V2 once we have
  a place to surface the answers, e.g. into the coaching-guide tool)

## V2 mission (after first paying customers retain)

Expand the data graph (Garmin partner API, Oura, WHOOP), add an
explainability layer ("why this session?"), and run heavier analytics
(limiter engine, 4-week Opus reviews) for premium tiers. Long-term:
"verdens mest intelligente adaptive AI-træningscoach" stays the north
star; V1 is the wedge.

## Core philosophy
- Combine real sport science (Daniels, Hansons, Pfitzinger, Norwegian /
  Polarized, Canova, Lydiard) with live data and AI.
- Everything must be **explanatory** — the user has to understand "why".
- Safety first: conservative progression, no dangerous load spikes.
- Simple beats sophisticated. The MCP chat assistant does the heavy
  reasoning; our job is clean data + tight tool descriptions.

## Tech stack (strict)
- **Frontend**: Next.js 16 (App Router) + TypeScript + Tailwind +
  shadcn/ui + Radix. Deployed to Vercel.
- **Backend**: Python 3.13 + FastAPI. Deployed to Railway.
- **Database**: Supabase (PostgreSQL + Auth + Storage). RLS on every
  user-scoped table.
- **AI (V1)**: None directly. The MCP connector lets the user's own
  Claude/ChatGPT/Gemini account do the reasoning over our data tools.
  All onboard-LLM code (Anthropic + MiniMax clients, plan_generator,
  limiter_engine, post_workout_engine) was removed in V1 cleanup —
  bringing it back is the V2 hook for premium analytics features.
- **Integrations (V1)**: Strava only. We "inherit" Garmin/Apple/Polar/
  Coros/Suunto/Wahoo because they all auto-sync to Strava.
- **Integrations (V2)**: Garmin official partner, Oura, WHOOP, Polar
  AccessLink — all gratis OAuth, no aggregator.
- **Payments**: Stripe Checkout, subscription model.
- **Email**: Resend. API key configured in `backend/.env` and as Railway
  env var (`RESEND_API_KEY`). Ready to use.
- **Cron**: Railway scheduled jobs (deferred — performance recompute
  runs after each sync today, that's enough for V1).

## Repo layout
```
evolverun/
├── frontend/        Next.js 16 app  (Vercel)
├── backend/         FastAPI service (Railway, port 8000)
│   └── mcp_server/  MCP tools mounted at /mcp on the same FastAPI app
├── supabase/        SQL migrations + config
├── docs/            ARCHITECTURE.md, ROADMAP.md, DEPLOY.md
└── CLAUDE.md        This file
```

## Production URLs
- Frontend: `https://evolverun.app` (custom domain, live — the primary URL)
- MCP endpoint: `https://mcp.evolverun.app/mcp` (custom domain on the Railway
  backend; `MCP_PUBLIC_URL` drives OAuth discovery + the `/dashboard/mcp` setup
  URL). This is what users add as a connector.
- Backend (origin, still valid): `https://evovlerun-production.up.railway.app`
  — Strava OAuth callback still uses this (`backend_public_url` unchanged).
- GitHub: `255065/evovlerun` (note: 3 v's in the name — typo, can be
  renamed later without breaking anything)

## Known blockers & gotchas
- **Strava API app is "Inactive"** → activity fetch returns `403 Application Status:
  Inactive`. OAuth login works, but the onboarding "N activities synced" count stays 0
  until the app is reactivated at https://www.strava.com/settings/api. Founder action.
- **Dead code**: `app/_landing/sections.tsx` exports a `Pricing()` component that the
  landing page never renders — don't wire live prices into it (deleting it is fine if asked).

## Claude Code production access (connectors + CLIs)
Claude can make live production changes directly. **MCP connectors** (preferred —
API-backed, precise) and CLIs available:

| Tool | Access | What for |
|------|--------|----------|
| Supabase | **MCP (active)** | Schema, raw SQL, `apply_migration`, security/perf **advisors**, logs, TS types. Project "ai coach" = `rjyrosxqqzbpcuuffliu`. |
| Stripe | **MCP (read + write)** | Prices, coupons/promo codes, refunds, subscriptions, docs. Live account `acct_1TYsDc3Ia3tUnKZg`. |
| Vercel | **MCP** + `vercel` CLI | Deployments, runtime logs/errors, domains; `vercel --prod` to deploy. |
| Railway | `railway` CLI | Deploy, env vars, logs. |
| GitHub | `gh` CLI | PRs, issues, branches. |
| Resend | `resend` CLI | Email — `RESEND_API_KEY` in `.env` + Railway. |

Live writes (Stripe objects, DB migrations, deploys) are side-effectful — confirm
specifics with the founder before running them, and never run a local dev server (see
the top rule). Auth config that the API can't set (e.g. leaked-password protection) is
a founder dashboard toggle.

To deploy backend: commit to `v1-prelaunch` → merge into `main` → `git push origin main` → Railway auto-deploys via GitHub. (Pushing to `main` needs explicit per-turn authorization.)
To deploy frontend: `cd ~/dev/evolverun/frontend && vercel --prod` (or the Vercel git auto-deploy on push to `main`).

## Changelog — keep `CHANGELOG.md` current
After any **notable** change, add a one-line entry to `CHANGELOG.md` (repo root)
under `## [Unreleased]`, grouped by **Added / Changed / Fixed / Ops**. Plain
language, founder-readable.

- **Log**: shipped features, bug fixes, infra / config / deploy changes, schema or
  API changes, and product decisions.
- **Don't log**: refactors with no behaviour change, typo / formatting fixes, WIP —
  git history already covers those. The changelog is for recall, not a commit mirror.
- When `[Unreleased]` entries ship, move them under a dated heading (`## 2026-06-21`).

## Coding rules
1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" → "Write tests for invalid inputs, then make them pass"
"Fix the bug" → "Write a test that reproduces it, then make it pass"
"Refactor X" → "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.


- Think step-by-step before coding. Don't speculatively refactor.
- Clean, modular, well-named identifiers. Comment only when the WHY is
  non-obvious.
- TypeScript strict on frontend.
- Security-first: encrypt all provider tokens with Fernet, never log
  secrets, RLS on every user-scoped Supabase table.
- Tests where they catch real regressions.
- Errors propagate; don't swallow them silently.

## MCP tool surface (V1 — locked at 11 tools)
1. `conversation-initialisation-critical-instructions` — coaching guide
2. `get-recent-activities`
3. `get-activity-details`
4. `get-run-splits`
5. `get-period-summary` — Chirona-parity aggregate
6. `get-latest-run`
7. `get-latest-sleep` — Strava has no sleep → returns "not available" in V1
8. `get-latest-body` — Strava has no body comp → ditto
9. `get-planned-workouts`
10. `save-training-plan` — only plan-write tool, atomic, batch-friendly
11. `delete-planned-workout`

Adding tools: don't. The chat assistant is doing fine with 11. If we
need more, expand `save-training-plan`'s argument schema instead of
adding a 12th tool. LLM tool-selection accuracy collapses above ~15
tools.

## Feature Factory (.claude/)
For non-trivial features, run the `feature-factory` skill — it drives 7
agents (`.claude/agents/`) through research → story → spec → backend →
frontend → verify → validate, with 3 human checkpoints (approve story,
approve brief, approve PR). Standalone changes can use the
`build-with-tests` skill for the same conventions.
- **Builders are folder-scoped, hard-enforced.** A `PreToolUse` hook
  (`.claude/hooks/scope-guard.sh`) reads `.claude/.active-scope` and blocks
  writes outside the active half. It fail-opens when no sentinel exists, so
  normal sessions aren't restricted. `secret-guard.sh` always blocks writes
  to `.env`/`*.key`/`*.pem`/secrets files; a git pre-commit hook
  (`.githooks/`, enabled via `core.hooksPath`) covers the commit path.
- **Frontend tests**: Vitest + RTL. `cd frontend && npm run test`.
- **Backend tests**: `cd backend && ./.venv/bin/python -m pytest -q`.

## Role / persona
You are both a senior full-stack developer AND a sport scientist /
endurance coach. Be proactive about technical refactors, tooling, and
product instincts — but never sneak in features the founder didn't ask
for. Especially:
- ❌ Don't propose a Daily Adapter (founder rejected)
- ❌ Don't propose Terra integration in V1 (cost-blocked)
- ❌ Don't propose new MCP tools without explicit ask

## Physiology knowledge
Cardiac drift, pace decay, running economy, ACWR, HRV, lactate threshold,
zone-2 training, training methodologies (Daniels, Hansons, Pfitzinger,
Norwegian, Polarized, Canova, Lydiard) and their strengths / weaknesses.
Use this when reasoning about *what the user should ask the chat
assistant*, not to author training advice yourself — that's the LLM's job.
