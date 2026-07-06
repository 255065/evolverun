"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error: string | null;
  /** Set after signup when an email confirmation is required (no session yet). */
  emailSent?: boolean;
};

export type ResetRequestState = {
  error: string | null;
  sent: boolean;
};

/** Restrict redirects to in-app paths so we can't be open-redirected to a
 * phishing target. Any value that isn't a same-origin path falls back to
 * the dashboard. */
function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  const target = typeof raw === "string" ? raw : "";
  if (target.startsWith("/") && !target.startsWith("//")) return target;
  return "/dashboard";
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectTarget(formData.get("redirect"));

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect(next);
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("fullName") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  // Land the confirmation link on the onboarding funnel, so a new user connects
  // Strava and subscribes before the dashboard. Origin comes from the request so
  // it's right in prod + preview.
  const hdrs = await headers();
  const host = hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const emailRedirectTo = `${proto}://${host}/auth/callback?next=${encodeURIComponent(
    "/onboarding",
  )}`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName }, emailRedirectTo },
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");

  // With "Confirm email" enabled, signUp returns no session until the link is
  // clicked — show the check-your-inbox screen instead of bouncing to a
  // protected route. If a session does exist (email confirmation disabled), go
  // straight into the onboarding funnel rather than the dashboard.
  if (!data.session) {
    return { error: null, emailSent: true };
  }
  redirect("/onboarding");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/** Send a password-reset email. We always report success (never reveal whether
 * an account exists for the address) unless Supabase itself errors. The email
 * link routes through /auth/callback, which exchanges the code for a session
 * and forwards to /reset-password. */
export async function requestPasswordResetAction(
  _prev: ResetRequestState,
  formData: FormData,
): Promise<ResetRequestState> {
  const email = String(formData.get("email") ?? "");

  const hdrs = await headers();
  const host = hdrs.get("host") ?? "";
  const proto = hdrs.get("x-forwarded-proto") ?? "https";
  const redirectTo = `${proto}://${host}/auth/callback?next=/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  if (error) {
    return { error: error.message, sent: false };
  }
  return { error: null, sent: true };
}

/** Set a new password for the user in the (reset-link) session. */
export async function updatePasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
