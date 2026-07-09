import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// GET /connect/[provider]?next=/onboarding
//
// Starts a provider OAuth connect. This is a route handler reached by a plain
// top-level navigation (not a Server Action) on purpose: the flow ends in a
// redirect to the provider's *external* authorize URL, and Server Actions are
// submitted via fetch — a cross-origin redirect from one never navigates the
// browser. A GET route returning an HTTP 307 to strava.com does.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  const url = new URL(request.url);

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.redirect(new URL("/login", url));
  }

  // Optional in-app path to return to after the OAuth round-trip. Only forward
  // same-origin paths — no scheme, no protocol-relative // — the backend
  // re-validates, but there's no reason to send anything else.
  const next = url.searchParams.get("next") ?? "";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "";
  const qs = safeNext ? `?next=${encodeURIComponent(safeNext)}` : "";

  const response = await fetch(`${BACKEND_URL}/providers/${provider}/authorize${qs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
  });

  if (!response.ok) {
    const dest = safeNext || "/dashboard/connections";
    return NextResponse.redirect(
      new URL(`${dest}?provider=${provider}&status=connect_failed`, url),
    );
  }

  const { authorize_url } = (await response.json()) as { authorize_url: string };
  return NextResponse.redirect(authorize_url);
}
