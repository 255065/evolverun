import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ENFORCE_SUBSCRIPTION = process.env.NEXT_PUBLIC_ENFORCE_SUBSCRIPTION === "true";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAuthPage = pathname.startsWith("/login") || pathname.startsWith("/signup");
  // `/oauth/consent` is auth-required because we need to know who's granting
  // access to the client. `/oauth/*` other paths (none for now) would also
  // sit behind login.
  const isProtected =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/oauth/") ||
    pathname.startsWith("/onboarding");

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve the original URL *with its query string* so the consent
    // parameters survive the round-trip through login.
    const fullPath = pathname + (request.nextUrl.search || "");
    url.searchParams.set("redirect", fullPath);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    // Already logged in and hitting /login? Honor an explicit ?redirect= so
    // the OAuth consent flow (which sends authenticated users here just in
    // case) doesn't get stuck on the dashboard.
    const redirectParam = request.nextUrl.searchParams.get("redirect");
    if (redirectParam && redirectParam.startsWith("/") && !redirectParam.startsWith("//")) {
      return NextResponse.redirect(new URL(redirectParam, request.url));
    }
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // V1 paywall — only enforced when the env flag is on. Account, OAuth, and
  // onboarding are always reachable so users can start, fix, or recover from
  // a failed subscription without getting locked out of their own data.
  // Unpaid users hitting the dashboard are routed into the onboarding funnel
  // (connect Strava → pay), not the bare billing page.
  if (
    user &&
    ENFORCE_SUBSCRIPTION &&
    pathname.startsWith("/dashboard") &&
    !pathname.startsWith("/dashboard/account")
  ) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("subscription_status")
      .eq("id", user.id)
      .single();
    const status = profile?.subscription_status;
    const active = status === "active" || status === "trialing";
    if (!active) {
      const url = request.nextUrl.clone();
      url.pathname = "/onboarding";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return response;
}
