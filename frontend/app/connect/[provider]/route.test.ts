import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route handler reads createClient().auth.getSession() for the bearer token
// and ends in NextResponse.redirect(authorize_url). Mock the session and fetch
// so we can inspect the backend URL it hits and the redirect it returns.
const mockGetSession = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getSession: mockGetSession },
  }),
}));

import { GET } from "./route";

function req(search: string): Request {
  return new Request(`http://localhost:3000/connect/strava${search}`);
}

const params = Promise.resolve({ provider: "strava" });

// A fresh Response per call — a single Response body can only be read once.
function stubFetch() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      new Response(JSON.stringify({ authorize_url: "https://strava/oauth" }), { status: 200 }),
    );
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connect route next-threading", () => {
  it("forwards a safe same-origin next as a ?next= query on authorize", async () => {
    const fetchSpy = stubFetch();

    const res = await GET(req("?next=/onboarding"), { params });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://localhost:8000/providers/strava/authorize?next=%2Fonboarding",
    );
    // 307 redirect to the external authorize URL — the whole point of the route.
    expect(res.headers.get("location")).toBe("https://strava/oauth");
  });

  it("omits the query when no next is given (dashboard connect path)", async () => {
    const fetchSpy = stubFetch();

    await GET(req(""), { params });

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://localhost:8000/providers/strava/authorize",
    );
  });

  it("drops an unsafe next (protocol-relative / absolute URL)", async () => {
    const fetchSpy = stubFetch();

    await GET(req("?next=//evil.com"), { params });
    await GET(req("?next=https://evil.com"), { params });

    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:8000/providers/strava/authorize");
    expect(fetchSpy.mock.calls[1][0]).toBe("http://localhost:8000/providers/strava/authorize");
  });

  it("redirects to /login when there is no session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const fetchSpy = stubFetch();

    const res = await GET(req("?next=/onboarding"), { params });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });
});
