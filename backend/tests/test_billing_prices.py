"""Live prices endpoint — reads amounts from Stripe, degrades to null on failure."""

from types import SimpleNamespace

import stripe

from app.routers import billing


def _settings(*, secret="sk_test_x", monthly="price_monthly", yearly="price_yearly"):
    return SimpleNamespace(
        stripe_secret_key=secret,
        stripe_price_id=monthly,
        stripe_price_id_yearly=yearly,
    )


def _reset_cache():
    # The endpoint memoises across calls; clear it so each test sees a fresh fetch.
    billing._prices_cache = None


def test_prices_map_monthly_and_yearly(monkeypatch):
    _reset_cache()
    prices = {
        "price_monthly": {"unit_amount": 799, "currency": "eur", "recurring": {"interval": "month"}},
        "price_yearly": {"unit_amount": 6900, "currency": "eur", "recurring": {"interval": "year"}},
    }
    monkeypatch.setattr(stripe.Price, "retrieve", lambda pid: prices[pid])
    resp = billing.get_prices(_settings())
    assert resp.monthly.unit_amount == 799
    assert resp.monthly.interval == "month"
    assert resp.yearly.unit_amount == 6900
    assert resp.yearly.interval == "year"
    assert resp.yearly.currency == "eur"


def test_prices_null_when_secret_unset(monkeypatch):
    _reset_cache()
    resp = billing.get_prices(_settings(secret=""))
    assert resp.monthly is None
    assert resp.yearly is None


def test_price_null_when_id_unset(monkeypatch):
    _reset_cache()
    monkeypatch.setattr(
        stripe.Price,
        "retrieve",
        lambda pid: {"unit_amount": 799, "currency": "eur", "recurring": {"interval": "month"}},
    )
    resp = billing.get_prices(_settings(yearly=""))
    assert resp.monthly.unit_amount == 799
    assert resp.yearly is None


def test_price_null_when_fetch_fails(monkeypatch):
    _reset_cache()

    def _retrieve(pid):
        if pid == "price_monthly":
            return {"unit_amount": 799, "currency": "eur", "recurring": {"interval": "month"}}
        raise stripe.StripeError("boom")

    monkeypatch.setattr(stripe.Price, "retrieve", _retrieve)
    resp = billing.get_prices(_settings(yearly="price_broken"))
    assert resp.monthly.unit_amount == 799
    assert resp.yearly is None
