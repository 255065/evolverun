import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// getSupabaseAccessToken() → createClient().auth.getSession() returns a token,
// and connectProviderAction ends in redirect(authorize_url). Mock both so the
// action runs to the fetch and we can inspect the URL it hit.
const mockGetSession = vi.fn();
const redirectMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getSession: mockGetSession },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

import { connectProviderAction } from "./actions";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

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
  redirectMock.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("connectProviderAction next-threading", () => {
  it("forwards a safe same-origin next as a ?next= query on authorize", async () => {
    const fetchSpy = stubFetch();

    await connectProviderAction(form({ provider: "strava", next: "/onboarding" }));

    const calledUrl = fetchSpy.mock.calls[0][0] as string;
    expect(calledUrl).toBe(
      "http://localhost:8000/providers/strava/authorize?next=%2Fonboarding",
    );
    expect(redirectMock).toHaveBeenCalledWith("https://strava/oauth");
  });

  it("omits the query when no next is given (dashboard connect path)", async () => {
    const fetchSpy = stubFetch();

    await connectProviderAction(form({ provider: "strava" }));

    expect(fetchSpy.mock.calls[0][0]).toBe(
      "http://localhost:8000/providers/strava/authorize",
    );
  });

  it("drops an unsafe next (protocol-relative / absolute URL)", async () => {
    const fetchSpy = stubFetch();

    await connectProviderAction(form({ provider: "strava", next: "//evil.com" }));
    await connectProviderAction(form({ provider: "strava", next: "https://evil.com" }));

    expect(fetchSpy.mock.calls[0][0]).toBe("http://localhost:8000/providers/strava/authorize");
    expect(fetchSpy.mock.calls[1][0]).toBe("http://localhost:8000/providers/strava/authorize");
  });
});
