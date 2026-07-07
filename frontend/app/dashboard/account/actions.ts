"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function getToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) redirect("/login");
  return session.access_token;
}

export type ProfileFormState = { ok: boolean; error?: string };
export type PasswordFormState = { ok: boolean; error?: string };

/**
 * Persist the First / Last name fields. We store as a single full_name
 * column so a "Valdemar Størum" round-trips cleanly. Email lives on
 * auth.users — we don't expose changing it from this page (Supabase
 * email change requires a re-verification flow we're not building in V1).
 */
export async function saveProfileAction(
  _prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const first = String(formData.get("first_name") ?? "").trim();
  const last = String(formData.get("last_name") ?? "").trim();
  const fullName = [first, last].filter(Boolean).join(" ");

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: fullName || null })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/account");
  return { ok: true };
}

export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  const password = String(formData.get("password") ?? "");

  if (password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  // The logged-in Supabase session authenticates the request, so updateUser
  // changes the password without re-entering the current one. Simpler for the
  // user; the trade-off is no extra guard against someone on an unlocked
  // session — acceptable for V1.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

export type BillingStatus = {
  status: string | null;
  price_id: string | null;
  current_period_end: string | null;
  customer_id: string | null;
  has_subscription: boolean;
  interval: string | null; // "month" | "year"
};

export async function loadBillingStatus(): Promise<BillingStatus | null> {
  try {
    const token = await getToken();
    const res = await fetch(`${BACKEND_URL}/billing/status`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as BillingStatus;
  } catch {
    return null;
  }
}

export type PlanPrice = {
  unit_amount: number; // smallest currency unit (e.g. cents)
  currency: string;
  interval: string; // "month" | "year"
};

export type Prices = {
  monthly: PlanPrice | null;
  yearly: PlanPrice | null;
};

/**
 * Live monthly/yearly amounts from Stripe (via the public backend endpoint) so
 * the pricing UI never drifts from the real prices. No auth — the marketing
 * pages are unauthenticated. Returns null on any failure; callers fall back to
 * static defaults so a page never shows a broken price.
 */
export async function loadPrices(): Promise<Prices | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/billing/prices`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Prices;
  } catch {
    return null;
  }
}

/**
 * Kick off a Stripe Checkout session for the chosen plan and redirect the
 * browser to it. Bound with a plan in the plan-picker form; defaults to monthly
 * so any caller that omits it (or passes a FormData) still gets a valid plan.
 * We don't expose Stripe keys to the client at all.
 */
export async function startCheckoutAction(plan: "monthly" | "yearly" = "monthly") {
  const planParam = plan === "yearly" ? "yearly" : "monthly";
  const token = await getToken();
  const res = await fetch(
    `${BACKEND_URL}/billing/create-checkout-session?plan=${planParam}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Checkout failed (${res.status}): ${text}`);
  }
  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

/**
 * Hand the user off to the Stripe billing portal so they can update card,
 * cancel, view invoices, etc. — without us reimplementing any of it.
 */
export async function openBillingPortalAction() {
  const token = await getToken();
  const res = await fetch(`${BACKEND_URL}/billing/create-portal-session`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Portal failed (${res.status}): ${text}`);
  }
  const { url } = (await res.json()) as { url: string };
  redirect(url);
}

/**
 * Permanently delete the current user. Calls backend DELETE /auth/me which
 * cancels the Stripe subscription, deletes the auth.user row, and cascades
 * all user-scoped data. After success we log the (now-orphan) Supabase
 * session out and land the visitor on the marketing root.
 */
export async function deleteAccountAction() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) redirect("/login");

  const res = await fetch(`${BACKEND_URL}/auth/me`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 204) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }

  // The auth user is gone — make sure the cookie session is too. Without
  // signOut the browser would keep a now-invalid JWT and bounce back to
  // /login on the next protected request, which is ugly.
  await supabase.auth.signOut();
  redirect("/?deleted=1");
}
