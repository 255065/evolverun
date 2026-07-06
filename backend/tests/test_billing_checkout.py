"""Plan routing for the checkout endpoint — `plan` selects monthly vs yearly price."""

from types import SimpleNamespace

import pytest
import stripe
from fastapi import HTTPException

from app.routers import billing

USER = SimpleNamespace(id="user-1", email="a@b.com")


def _settings(*, monthly="price_monthly", yearly="price_yearly"):
    return SimpleNamespace(
        stripe_secret_key="sk_test_x",
        stripe_price_id=monthly,
        stripe_price_id_yearly=yearly,
        frontend_url="https://evolverun.app",
    )


def _capture_session(monkeypatch) -> dict:
    """Stub the Stripe customer + Checkout Session create; return captured kwargs."""
    captured: dict = {}
    monkeypatch.setattr(billing, "_ensure_customer", lambda client, user: "cus_x")

    def _fake_create(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(url="https://checkout.stripe.com/x")

    monkeypatch.setattr(stripe.checkout.Session, "create", _fake_create)
    return captured


def test_yearly_plan_uses_yearly_price(monkeypatch):
    captured = _capture_session(monkeypatch)
    resp = billing.create_checkout_session(USER, _settings(), plan="yearly")
    assert resp.url == "https://checkout.stripe.com/x"
    assert captured["line_items"] == [{"price": "price_yearly", "quantity": 1}]


def test_default_plan_uses_monthly_price(monkeypatch):
    captured = _capture_session(monkeypatch)
    billing.create_checkout_session(USER, _settings())
    assert captured["line_items"] == [{"price": "price_monthly", "quantity": 1}]


def test_checkout_success_lands_on_dashboard(monkeypatch):
    """Paying users land on the product, not the billing page (funnel exit)."""
    captured = _capture_session(monkeypatch)
    billing.create_checkout_session(USER, _settings())
    assert captured["success_url"] == "https://evolverun.app/dashboard?checkout=success"


def test_unconfigured_plan_returns_503(monkeypatch):
    _capture_session(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        billing.create_checkout_session(USER, _settings(yearly=""), plan="yearly")
    assert exc.value.status_code == 503
