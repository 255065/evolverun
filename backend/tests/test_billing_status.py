"""billing_status resolves the plan interval from the subscribed price id."""

from types import SimpleNamespace

from app.routers import billing

USER = SimpleNamespace(id="u1", email="a@b.com")


def _settings(monthly="price_m", yearly="price_y"):
    return SimpleNamespace(stripe_price_id=monthly, stripe_price_id_yearly=yearly)


def _fake_supabase(row_data):
    # A chainable stub: table().select().eq().single().execute() -> row_data.
    chain = SimpleNamespace()
    chain.table = lambda *a, **k: chain
    chain.select = lambda *a, **k: chain
    chain.eq = lambda *a, **k: chain
    chain.single = lambda *a, **k: chain
    chain.execute = lambda: SimpleNamespace(data=row_data)
    return chain


def _row(price_id, status="active"):
    return {
        "subscription_status": status,
        "subscription_price_id": price_id,
        "subscription_current_period_end": None,
        "stripe_customer_id": "cus_1",
    }


def test_interval_year(monkeypatch):
    monkeypatch.setattr(billing, "get_supabase_admin", lambda: _fake_supabase(_row("price_y")))
    resp = billing.billing_status(USER, _settings())
    assert resp.interval == "year"
    assert resp.has_subscription is True


def test_interval_month(monkeypatch):
    monkeypatch.setattr(billing, "get_supabase_admin", lambda: _fake_supabase(_row("price_m")))
    resp = billing.billing_status(USER, _settings())
    assert resp.interval == "month"


def test_interval_none_when_price_unknown(monkeypatch):
    monkeypatch.setattr(
        billing, "get_supabase_admin", lambda: _fake_supabase(_row("price_old", status=None))
    )
    resp = billing.billing_status(USER, _settings())
    assert resp.interval is None
