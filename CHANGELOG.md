# Changelog

All **notable** changes to EvolveRun, newest first — a founder-readable record of
what shipped and why. Format loosely follows
[Keep a Changelog](https://keepachangelog.com). EvolveRun is continuously deployed,
so entries are grouped by **date** rather than version tags.

Grouping per entry: **Added / Changed / Fixed / Ops**. This is for recall, not a
mirror of git history — see `CLAUDE.md` for what to log and what to skip.

## [Unreleased]

### Added
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
