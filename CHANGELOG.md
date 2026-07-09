# Changelog

All **notable** changes to EvolveRun, newest first — a founder-readable record of
what shipped and why. Format loosely follows
[Keep a Changelog](https://keepachangelog.com). EvolveRun is continuously deployed,
so entries are grouped by **date** rather than version tags.

Grouping per entry: **Added / Changed / Fixed / Ops**. This is for recall, not a
mirror of git history — see `CLAUDE.md` for what to log and what to skip.

## [Unreleased]

### Changed
- **Initial Strava sync now pulls up to a full year** (was 90 days). Onboarding
  can now show "1 year of history" for athletes who have it; those with less
  simply get what exists.

### Fixed
- **Landing-page chat demo no longer auto-plays on load.** On large/tall desktop
  displays the demo's top peeked into the viewport at load, satisfying the old
  desktop `threshold: 0.15` trigger, so the animation played out before the user
  scrolled to it (leaving it parked on the final frame). Unified the scroll
  trigger to the mobile guard — a negative bottom `rootMargin` that holds until
  the player scrolls into view — for all viewports.
- **"Connect Strava" now actually opens Strava.** The button was a Server Action
  ending in `redirect()` to Strava's external authorize URL — but Server Actions
  are fetch-submitted and can't navigate the browser cross-origin, so clicking did
  nothing (the backend returned a valid URL; the browser just never moved). New
  users were stuck at the onboarding connect step. Moved OAuth start to a
  `/connect/[provider]` route handler linked with a plain `<a>`, which issues a
  real top-level redirect to Strava. Also fixes the same dead button on the
  dashboard and Connections pages.
- **A saved training plan whose sessions are all in the past is no longer
  invisible.** The dashboard and the `get-planned-workouts` tool both only looked
  from today forward, so a plan whose dates had drifted into the past showed an
  empty schedule and the tool wrongly reported *"No active training plan yet."*
  Now: the dashboard falls back to the plan's own sessions (any date) so they
  render; `get-planned-workouts` reports the active plan and its real date range
  instead of claiming no plan exists; and `save-training-plan` returns a
  `warning`/`past_dated_count` when it's handed sessions dated before today, so a
  mis-anchored plan is caught at save time rather than looking like a silent
  success.

### Ops
- **MCP moved to a custom domain: `https://mcp.evolverun.app/mcp`.** Added the
  domain to the Railway backend (Cloudflare CNAME `mcp` → Railway, DNS-only) and
  set `MCP_PUBLIC_URL` to it, so OAuth discovery + the `/dashboard/mcp` setup URL
  now advertise the branded domain. The Railway origin still serves the same app
  (Strava callback unchanged). Existing connectors must be re-added at the new URL.

### Added
- **Meta (Facebook/Instagram) Pixel for ad conversion tracking.** New
  `components/meta-pixel.tsx` (base pixel + `PageView` on every route change, via
  `next/script`) mounts in the root layout, plus `components/pixel-track.tsx` for
  one-shot conversion events. Fires `CompleteRegistration` on signup and `Purchase`
  (EUR) on the `/dashboard?checkout=success` Stripe landing, so Instagram/Facebook
  ads can optimise toward real signups and subscriptions. **Dormant until
  `NEXT_PUBLIC_META_PIXEL_ID` is set in Vercel** — no pixel loads and events no-op
  without it, so it's safe to ship ahead of the ad account. (No CSP to allowlist.)
- **Price tags read live from Stripe.** New public `GET /billing/prices` returns the
  monthly/yearly amounts; the paywall picker, account page, and `/pricing` now render
  the real prices (plus the derived per-month figure and savings %), so a Stripe price
  change shows up without a redeploy. Cached ~5 min; falls back to static defaults if
  Stripe is unreachable.
- **Onboarding funnel**: new signups now flow **signup → confirm email →
  `/onboarding` (connect Strava, *before* payment) → hard paywall → dashboard**.
  The connect step shows only the *quantity* of synced history ("N activities ·
  Y years"), never the analysis — that stays behind the paywall — so the user's
  own data becomes the reason to subscribe. Non-payers stay **dormant**
  (connection + workouts persist; the middleware paywall keeps `/dashboard`
  locked until they pay). Post-signup landing, the middleware paywall redirect,
  and Stripe checkout success now route through the funnel to `/dashboard`. The
  Strava OAuth callback can return to `/onboarding` via a same-origin `next`
  carried in the signed OAuth state.
- **Monthly / yearly plan picker** on the paywall: new users choose **Pro Monthly
  €7.99** or **Pro Annual €69** before checkout, and the selected plan routes to its
  own Stripe price. Checkout endpoint takes a `plan` param; adds `STRIPE_PRICE_ID_YEARLY`.
- **Transactional billing emails** via Resend (`services/email.py`), sent best-effort
  from the webhook so a failed send never blocks subscription mirroring. From
  `noreply@evolverun.app` (domain verified).
- Onboarding gate: new signups now must **confirm their email** and **start a
  subscription before reaching the dashboard**. Signup shows a "check your email"
  screen; the confirmation link lands on the paywall. The auth callback handles
  both the PKCE (`code`) and OTP (`token_hash`) confirmation-link formats.
  (Enabled by Supabase "Confirm email" + the `ENFORCE_SUBSCRIPTION` /
  `NEXT_PUBLIC_ENFORCE_SUBSCRIPTION` flags.)

### Fixed
- Account page showed "€9 per month" while the actual price (and the rest of the
  site — pricing, landing, terms) is **€7.99**. Corrected the account-page copy.
- Dashboard mobile layout: the "Get set up" number badges rendered as ovals and
  the Claude/ChatGPT coach icons were squished on narrow phones. Added the missing
  flex constraints so badges/icons stay perfectly round/square and text wraps
  cleanly.

## 2026-06-21

### Added
- Stripe billing wired up and live-tested in **test mode**: product + €9/mo EUR
  price, webhook (4 events) with signing secret in Railway, and a customer-portal
  configuration so the "View billing" button works.
- `CHANGELOG.md` + a CLAUDE.md rule to keep it current.

### Changed
- Account page: inline "Security" section replaced with a **Change password** button
  + modal (asks for the new password only).
- Dashboard and landing made **mobile-friendly** (Chirona-style tab bars; demo plays
  on scroll at full size; scroll-reveal box animations removed, button hovers kept).
- ChatGPT setup tab switched from an API-key form to the **MCP OAuth guide** (matches
  the Claude flow).

### Fixed
- **Stripe webhook** no longer leaves a paid subscription showing "No plan". Stripe
  delivers `subscription.created` (incomplete) and `.updated` (active) out of order;
  the handler now re-fetches the live subscription so the mirrored status can't
  regress. (`backend/app/routers/billing.py`)
- **ChatGPT MCP connect**: aligned the OAuth issuer trailing slash with FastMCP so
  ChatGPT's strict discovery validation passes.
- **Strava webhook**: removed the `?token=` query param from the callback URL (Strava
  rejects query params); events are ID-only and re-fetched via the authenticated API.

### Ops
- Strava webhook (re)registered as subscription `354010`.
- `ENFORCE_SUBSCRIPTION=false` during test-mode billing (test subs aren't real;
  turning the paywall on is part of go-live).
