"""Stripe Checkout subscription router.

V1 has a single price tier. Users sign up → onboarding → /dashboard/account →
Checkout. Stripe is the source of truth for subscription state; we mirror just
enough on `profiles` (status, current_period_end, customer_id) to answer "is
this user allowed in?" without hitting Stripe on every dashboard request.

Endpoints
---------
- POST /billing/create-checkout-session  → returns { url } to Stripe Checkout
- POST /billing/create-portal-session    → returns { url } to billing portal
- GET  /billing/status                   → returns the user's mirrored state
- POST /billing/webhook                  → Stripe → us; updates profiles

The webhook MUST be public (no auth header) and signature-verified — Stripe
will not retry against an authenticated route.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Annotated, Any

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.core.ratelimit import rate_limit
from app.core.security import CurrentUser, get_current_user
from app.core.supabase import get_supabase_admin
from app.services.email import send_email

log = logging.getLogger("evolverun.billing")

router = APIRouter(prefix="/billing", tags=["billing"])


def _stripe_client(settings: Settings) -> Any:
    """Initialise the Stripe SDK with the configured secret key.

    Pinning the API version keeps webhook payloads on a known schema across
    library upgrades — if Stripe deprecates the event shape we read, we'll
    notice on intentional version bumps, not at random.
    """
    if not settings.stripe_secret_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Stripe is not configured on this environment",
        )
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = "2024-12-18.acacia"
    return stripe


def _ensure_customer(client: Any, user: CurrentUser) -> str:
    """Get or create a Stripe customer for this user.

    We persist the customer id on `profiles.stripe_customer_id` the first
    time so the second checkout doesn't create a duplicate customer record
    (Stripe will happily make a new one for every Checkout if we don't pin).
    """
    supabase = get_supabase_admin()
    profile = (
        supabase.table("profiles")
        .select("stripe_customer_id, email, full_name")
        .eq("id", user.id)
        .single()
        .execute()
    )
    existing_id = (profile.data or {}).get("stripe_customer_id")
    if existing_id:
        return existing_id

    customer = client.Customer.create(
        email=user.email or (profile.data or {}).get("email"),
        name=(profile.data or {}).get("full_name") or None,
        metadata={"supabase_user_id": user.id},
    )
    supabase.table("profiles").update({"stripe_customer_id": customer.id}).eq(
        "id", user.id
    ).execute()
    return customer.id


# ---- Request / response models ------------------------------------------


class CheckoutResponse(BaseModel):
    url: str


class PortalResponse(BaseModel):
    url: str


class StatusResponse(BaseModel):
    status: str | None
    price_id: str | None
    current_period_end: datetime | None
    customer_id: str | None
    has_subscription: bool


class PriceInfo(BaseModel):
    unit_amount: int  # smallest currency unit (e.g. cents)
    currency: str
    interval: str  # "month" | "year"


class PricesResponse(BaseModel):
    monthly: PriceInfo | None
    yearly: PriceInfo | None


# ---- Endpoints ----------------------------------------------------------


@router.post("/create-checkout-session", response_model=CheckoutResponse)
def create_checkout_session(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    plan: str = "monthly",
) -> CheckoutResponse:
    # Pick the price for the requested plan: "yearly" → Pro Annual, anything
    # else → the monthly tier. Each plan needs its price configured.
    price_id = (
        settings.stripe_price_id_yearly if plan == "yearly" else settings.stripe_price_id
    )
    if not price_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"No Stripe price configured for plan '{plan}'",
        )

    client = _stripe_client(settings)
    customer_id = _ensure_customer(client, user)
    # Land paying users on the product itself, not the billing page — this is
    # the last step of the onboarding funnel.
    success_url = f"{settings.frontend_url}/dashboard?checkout=success"
    cancel_url = f"{settings.frontend_url}/dashboard/account?checkout=cancelled"

    session_obj = client.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=success_url,
        cancel_url=cancel_url,
        allow_promotion_codes=True,
        # Persist the supabase user id on the session metadata so the
        # webhook can find the right profile row even if customer mapping
        # is somehow lost.
        metadata={"supabase_user_id": user.id},
        subscription_data={"metadata": {"supabase_user_id": user.id}},
    )
    return CheckoutResponse(url=session_obj.url)


@router.post("/create-portal-session", response_model=PortalResponse)
def create_portal_session(
    user: Annotated[CurrentUser, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> PortalResponse:
    client = _stripe_client(settings)
    customer_id = _ensure_customer(client, user)
    portal_session = client.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{settings.frontend_url}/dashboard/account",
    )
    return PortalResponse(url=portal_session.url)


@router.get("/status", response_model=StatusResponse)
def billing_status(
    user: Annotated[CurrentUser, Depends(get_current_user)],
) -> StatusResponse:
    supabase = get_supabase_admin()
    row = (
        supabase.table("profiles")
        .select(
            "stripe_customer_id, subscription_status, subscription_price_id, subscription_current_period_end"
        )
        .eq("id", user.id)
        .single()
        .execute()
    )
    data = row.data or {}
    period_end_raw = data.get("subscription_current_period_end")
    period_end = None
    if period_end_raw:
        # Postgres returns ISO 8601 — parse to make it timezone-aware so the
        # response always carries a UTC datetime.
        period_end = datetime.fromisoformat(period_end_raw.replace("Z", "+00:00"))
    sub_status = data.get("subscription_status")
    return StatusResponse(
        status=sub_status,
        price_id=data.get("subscription_price_id"),
        current_period_end=period_end,
        customer_id=data.get("stripe_customer_id"),
        has_subscription=sub_status in {"active", "trialing"},
    )


# ---- Live prices --------------------------------------------------------

# The displayed price amounts come straight from Stripe so the site never
# drifts from the real prices. Cache the lookup — prices change rarely and we
# don't want a Stripe round-trip on every (unauthenticated) page render.
_PRICES_TTL_SECONDS = 300
_prices_cache: tuple[float, PricesResponse] | None = None


def _fetch_price(price_id: str) -> PriceInfo | None:
    """Pull a single price's display info from Stripe, or None if the id is
    unset or the lookup fails (a Stripe outage must not break page render)."""
    if not price_id:
        return None
    try:
        price = stripe.Price.retrieve(price_id)
    except stripe.StripeError as exc:
        log.warning("Stripe price fetch failed for %s: %s", price_id, exc)
        return None
    recurring = price.get("recurring") or {}
    interval = recurring.get("interval")
    if price.get("unit_amount") is None or not interval:
        return None
    return PriceInfo(
        unit_amount=price["unit_amount"],
        currency=price["currency"],
        interval=interval,
    )


@router.get("/prices", response_model=PricesResponse)
def get_prices(
    settings: Annotated[Settings, Depends(get_settings)],
) -> PricesResponse:
    """Public: the live monthly/yearly amounts for the pricing UI.

    Returns nulls (not an error) when Stripe isn't configured or a price can't
    be read, so the frontend falls back to its static defaults.
    """
    global _prices_cache
    now = time.monotonic()
    if _prices_cache and now - _prices_cache[0] < _PRICES_TTL_SECONDS:
        return _prices_cache[1]

    if not settings.stripe_secret_key:
        return PricesResponse(monthly=None, yearly=None)

    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = "2024-12-18.acacia"
    result = PricesResponse(
        monthly=_fetch_price(settings.stripe_price_id),
        yearly=_fetch_price(settings.stripe_price_id_yearly),
    )
    _prices_cache = (now, result)
    return result


# ---- Webhook ------------------------------------------------------------


@router.post(
    "/webhook",
    include_in_schema=False,
    dependencies=[Depends(rate_limit("100/minute"))],
)
async def stripe_webhook(
    request: Request,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    """Receive Stripe events and mirror subscription state onto profiles.

    Public route — verified by Stripe's signature header, not Bearer auth.
    Stripe retries failures with exponential backoff for up to 3 days, so
    handlers must be idempotent.
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="STRIPE_WEBHOOK_SECRET is not configured",
        )

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret
        )
    except (ValueError, stripe.SignatureVerificationError) as exc:
        # Don't leak the cause — Stripe just wants a 400 and will retry only
        # for transient failures, not signature mismatches.
        log.warning("Stripe webhook signature verification failed: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="bad signature") from exc

    log.info("Stripe webhook: %s (id=%s)", event["type"], event["id"])

    # Initialise the SDK so subscription handlers can re-fetch the live object
    # (Stripe delivers events out of order — see _on_subscription_upserted).
    stripe.api_key = settings.stripe_secret_key
    stripe.api_version = "2024-12-18.acacia"

    # Idempotency: record the event id before processing. If the event was
    # already processed (e.g. Stripe retry after a 5xx) the INSERT raises a
    # unique-key violation, which we treat as "already done" and return 200
    # so Stripe stops retrying. We don't log a warning — duplicates are normal.
    supabase = get_supabase_admin()
    try:
        supabase.table("stripe_processed_events").insert({
            "event_id": event["id"],
            "event_type": event["type"],
        }).execute()
    except Exception as exc:
        # Duplicate key → already processed. Any other DB error is unexpected
        # but we still return 200 to avoid confusing Stripe's retry logic; the
        # event will be re-queued if the response is non-2xx.
        err_str = str(exc).lower()
        if "duplicate" in err_str or "unique" in err_str or "23505" in err_str:
            log.info("Stripe webhook duplicate, skipping: %s", event["id"])
            return {"received": "ok"}
        log.exception("Stripe event ledger insert failed for %s", event["id"])

    _handle_event(event)
    return {"received": "ok"}


def _handle_event(event: dict[str, Any]) -> None:
    """Dispatch on event type. Add handlers conservatively — every new event
    is a new failure mode."""
    etype = event["type"]
    data = event["data"]["object"]

    if etype == "checkout.session.completed":
        _on_checkout_completed(data)
    elif etype in {"customer.subscription.created", "customer.subscription.updated"}:
        _on_subscription_upserted(data)
    elif etype == "customer.subscription.deleted":
        _on_subscription_deleted(data)
    elif etype == "invoice.payment_failed":
        _on_payment_failed(data)
    else:
        log.debug("Ignoring Stripe event type %s", etype)


def _user_id_for_customer(customer_id: str | None, sub_metadata: dict[str, Any] | None = None) -> str | None:
    """Resolve a Stripe customer id back to a supabase user id.

    Prefer the supabase_user_id on the subscription metadata (set when we
    create the Checkout session) — that survives even if the customer row
    is mis-mapped. Falls back to profiles.stripe_customer_id.
    """
    if sub_metadata and (uid := sub_metadata.get("supabase_user_id")):
        return uid
    if not customer_id:
        return None
    supabase = get_supabase_admin()
    row = (
        supabase.table("profiles")
        .select("id")
        .eq("stripe_customer_id", customer_id)
        .limit(1)
        .execute()
    )
    if row.data:
        return row.data[0]["id"]
    return None


def _email_for_user(user_id: str) -> str | None:
    supabase = get_supabase_admin()
    row = supabase.table("profiles").select("email").eq("id", user_id).limit(1).execute()
    if row.data:
        return row.data[0].get("email")
    return None


def _notify(user_id: str, subject: str, html: str) -> None:
    """Best-effort billing notice. A failed send must not fail the webhook —
    Stripe's mirrored state is the part that has to land."""
    email = _email_for_user(user_id)
    if not email:
        return
    try:
        send_email(to=email, subject=subject, html=html)
    except Exception:
        log.exception("Billing notification email failed for user %s", user_id)


def _on_checkout_completed(session_obj: dict[str, Any]) -> None:
    """A successful Checkout means we have a customer + (usually) a sub.

    Stripe will also fire customer.subscription.created right after, so the
    full mirror happens there. Here we just make sure the customer id is
    persisted in case the user reached checkout before we managed to write
    it ourselves.
    """
    customer_id = session_obj.get("customer")
    user_id = (session_obj.get("metadata") or {}).get("supabase_user_id")
    if not customer_id or not user_id:
        return
    supabase = get_supabase_admin()
    supabase.table("profiles").update({"stripe_customer_id": customer_id}).eq(
        "id", user_id
    ).execute()


def _on_subscription_upserted(sub: dict[str, Any]) -> None:
    # Stripe delivers `customer.subscription.created` (status "incomplete") and
    # `.updated` (status "active") in the same instant and does NOT guarantee
    # order. Trusting the event payload lets a late "created" event regress a
    # live subscription back to "incomplete". Re-fetch the subscription so we
    # always mirror its current status, independent of delivery order.
    sub_id = sub.get("id")
    if sub_id:
        try:
            sub = stripe.Subscription.retrieve(sub_id)
        except stripe.StripeError as exc:  # fall back to the event payload
            log.warning("Re-fetch of subscription %s failed: %s", sub_id, exc)

    customer_id = sub.get("customer")
    metadata = sub.get("metadata") or {}
    user_id = _user_id_for_customer(customer_id, metadata)
    if not user_id:
        log.warning("Subscription %s has no resolvable user", sub.get("id"))
        return

    # `items.data[0].price.id` is the canonical price for single-item subs,
    # which is what V1 sells. If we ever do tiered subs we'll need to be
    # smarter here.
    items = (sub.get("items") or {}).get("data") or []
    first_item = items[0] if items else {}
    price_id = first_item["price"]["id"] if first_item.get("price") else None

    # `current_period_end` lives at two possible locations depending on the
    # webhook API version: pre-2025-ish it's on the subscription itself; in
    # the 2026 preview it moved to each subscription item so multi-cycle
    # subs can have per-item periods. V1 is single-item, so we try the
    # top-level field first, then fall back to the first item's value.
    period_end_unix = sub.get("current_period_end") or first_item.get("current_period_end")
    period_end = (
        datetime.fromtimestamp(period_end_unix, tz=timezone.utc).isoformat()
        if period_end_unix
        else None
    )

    supabase = get_supabase_admin()
    supabase.table("profiles").update(
        {
            "stripe_subscription_id": sub.get("id"),
            "subscription_status": sub.get("status"),
            "subscription_price_id": price_id,
            "subscription_current_period_end": period_end,
        }
    ).eq("id", user_id).execute()


def _on_subscription_deleted(sub: dict[str, Any]) -> None:
    user_id = _user_id_for_customer(sub.get("customer"), sub.get("metadata") or {})
    if not user_id:
        return
    supabase = get_supabase_admin()
    supabase.table("profiles").update(
        {
            "subscription_status": "canceled",
            "stripe_subscription_id": None,
            "subscription_current_period_end": None,
        }
    ).eq("id", user_id).execute()
    _notify(
        user_id,
        "Your EvolveRun subscription has ended",
        "<p>Your subscription was cancelled and access to EvolveRun has ended. "
        "You can resubscribe any time from your account page.</p>",
    )


def _on_payment_failed(invoice: dict[str, Any]) -> None:
    """Stripe already retries the charge (dunning); this just lets the user
    know before access lapses. profiles.subscription_status is not changed
    here — that mirror only happens on customer.subscription.updated."""
    user_id = _user_id_for_customer(invoice.get("customer"))
    if not user_id:
        return
    _notify(
        user_id,
        "We couldn't process your EvolveRun payment",
        "<p>Your most recent payment failed. Please update your payment method "
        "from your account page to keep your subscription active.</p>",
    )
