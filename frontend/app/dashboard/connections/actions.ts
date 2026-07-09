"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

async function getSupabaseAccessToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    redirect("/login");
  }
  return session.access_token;
}

export async function syncProviderAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  const days = Number(formData.get("days") ?? 30);
  if (!provider) return;

  const token = await getSupabaseAccessToken();

  // Fire-and-forget: an all-time backfill takes 3–5 minutes, which is
  // longer than Vercel's 60s server-action limit. We kick the request off
  // and don't wait for the response — backend keeps running independently.
  // The page redirects immediately so the user sees "Sync started" feedback
  // and can come back when the data is in. AbortSignal.timeout(2000) makes
  // the dispatch itself fail fast if Railway is unreachable.
  const longRunning = days === 0 || days > 180;
  if (longRunning) {
    fetch(`${BACKEND_URL}/providers/${provider}/sync?days=${days}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    }).catch(() => {
      /* request started server-side; we don't care if our side dropped */
    });
    redirect(
      `/dashboard/connections?provider=${provider}&status=sync_started`,
    );
  }

  // Short syncs (≤180 days) keep the synchronous flow — they finish well
  // within 60s and the user gets the "Sync færdig" banner with real counts.
  await fetch(`${BACKEND_URL}/providers/${provider}/sync?days=${days}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  redirect("/dashboard/connections?provider=" + provider + "&status=synced");
}

export async function disconnectProviderAction(formData: FormData) {
  const provider = String(formData.get("provider") ?? "");
  if (!provider) return;

  const token = await getSupabaseAccessToken();

  await fetch(`${BACKEND_URL}/providers/${provider}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  redirect("/dashboard/connections?provider=" + provider + "&status=disconnected");
}

export type ConnectionStatus = {
  provider: string;
  connected: boolean;
  provider_user_id: string | null;
  expires_at: string | null;
  scope: string | null;
  last_sync_at: string | null;
};

export async function getConnectionStatus(provider: string): Promise<ConnectionStatus | null> {
  try {
    const token = await getSupabaseAccessToken();
    const response = await fetch(`${BACKEND_URL}/providers/${provider}/status`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as ConnectionStatus;
  } catch {
    return null;
  }
}
