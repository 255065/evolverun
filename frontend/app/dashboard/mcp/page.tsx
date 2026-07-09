import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { getConnectionStatus } from "../connections/actions";
import { getConnectorStatus, listKeys } from "./actions";
import { CopyButton } from "../copy-button";

export const dynamic = "force-dynamic";

// Single source of truth for the public MCP endpoint. Reads the Vercel env
// at build/runtime, falls back to the canonical Railway URL from CLAUDE.md
// so the page never renders a localhost URL to a real user.
const MCP_URL =
  (process.env.NEXT_PUBLIC_BACKEND_URL && !process.env.NEXT_PUBLIC_BACKEND_URL.includes("localhost")
    ? process.env.NEXT_PUBLIC_BACKEND_URL
    : "https://evovlerun-production.up.railway.app") + "/mcp";

const SAMPLE_PROMPTS = [
  "Show my recent Strava activities",
  "Show my latest run",
  "Get the splits for my last run",
  "What's my training volume this month?",
  "Build me a 7-day training week",
];

function StepNumber({ n }: { n: number }) {
  return (
    <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#dc6b3f] text-xs font-semibold text-white">
      {n}
    </span>
  );
}

type Assistant = "claude" | "chatgpt";

function TabLink({
  assistant,
  active,
  connected,
  children,
}: {
  assistant: Assistant;
  active: boolean;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/dashboard/mcp?assistant=${assistant}`}
      className={
        "inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13.5px] font-medium transition " +
        (active
          ? "bg-neutral-950 text-white"
          : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50")
      }
    >
      {children}
      {connected && (
        <span
          className={
            "inline-flex items-center gap-1 text-[11px] font-semibold " +
            (active ? "text-emerald-300" : "text-emerald-600")
          }
        >
          ● Connected
        </span>
      )}
    </Link>
  );
}

export default async function MCPPage({
  searchParams,
}: {
  searchParams: Promise<{ assistant?: string }>;
}) {
  const params = await searchParams;
  const tab: Assistant = params.assistant === "chatgpt" ? "chatgpt" : "claude";

  const [keys, connector, strava] = await Promise.all([
    listKeys(),
    getConnectorStatus(),
    getConnectionStatus("strava"),
  ]);
  const activeKeys = keys.filter((k) => !k.revoked_at);
  const stravaConnected = strava?.connected ?? false;

  return (
    <div className="space-y-10">
      {/* ── Hero ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="evr-headline text-[clamp(34px,4.5vw,48px)] tracking-[-0.03em]">
          Add EvolveRun to your AI
        </h1>
        <p className="mt-2 text-[15px] text-neutral-600">Three steps. Takes under a minute.</p>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3.5 py-1.5 text-[12.5px] text-neutral-500">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <path d="M8 21h8M12 18v3" />
          </svg>
          This setup works best on a desktop browser.
        </p>
      </div>

      {/* ── Walkthrough video ───────────────────────────────────────────── */}
      <video
        className="w-full max-w-2xl rounded-2xl border border-neutral-200 shadow-sm"
        autoPlay
        muted
        loop
        playsInline
        src="/mcp-tutorial.mp4"
      />

      {/* ── Prerequisite: Strava ──────────────────────────────────────── */}
      {stravaConnected ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13.5px] text-emerald-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-9" />
          </svg>
          Strava connected — your data is ready.
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-800">
          <span>Connect Strava first so your AI has data to read.</span>
          <Link
            href="/dashboard/connections"
            className="font-medium text-amber-900 underline underline-offset-2 hover:no-underline"
          >
            Connect Strava →
          </Link>
        </div>
      )}

      {/* ── Assistant tabs ────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <TabLink assistant="claude" active={tab === "claude"} connected={connector.claude_connected}>
          Claude
        </TabLink>
        <TabLink assistant="chatgpt" active={tab === "chatgpt"} connected={activeKeys.length > 0}>
          ChatGPT &amp; other clients
        </TabLink>
      </div>

      {tab === "claude" ? (
        <>
          {/* ── Step 1 — Copy URL ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={1} />
                Copy your EvolveRun URL
              </CardTitle>
              <CardDescription>
                This is the EvolveRun MCP server URL. You&apos;ll paste it into Claude in the next
                step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-500">Claude MCP URL</label>
                <div className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 p-2">
                  <code className="flex-1 truncate font-mono text-sm text-neutral-900">{MCP_URL}</code>
                  <CopyButton text={MCP_URL} />
                </div>
                <p className="text-xs text-neutral-500">
                  Same URL for every user — Claude signs you into your own EvolveRun account via
                  OAuth in the next step.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── Step 2 — Add to Claude ────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={2} />
                Add to Claude
              </CardTitle>
              <CardDescription>
                Open Claude&apos;s connector settings, click <strong>Add custom connector</strong>,
                paste the URL you just copied, and approve access when prompted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="https://claude.ai/settings/connectors"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants()}
              >
                Open Claude Connectors →
              </a>
            </CardContent>
          </Card>

          {/* ── Step 3 — Start chatting ───────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={3} />
                Start chatting
              </CardTitle>
              <CardDescription>
                That&apos;s it. Ask Claude anything about your training — it now has your real
                Strava data and computed metrics (CTL, ATL, TSB, ACWR).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <li
                    key={prompt}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2"
                  >
                    <span className="truncate text-sm text-neutral-700">{prompt}</span>
                    <CopyButton text={prompt} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* ── Step 1 — Copy URL ─────────────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={1} />
                Copy your EvolveRun URL
              </CardTitle>
              <CardDescription>
                This is the EvolveRun MCP server URL. You&apos;ll paste it into ChatGPT in the
                next step.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-500">ChatGPT MCP URL</label>
                <div className="flex items-center gap-2 rounded-xl border border-neutral-300 bg-neutral-50 p-2">
                  <code className="flex-1 truncate font-mono text-sm text-neutral-900">{MCP_URL}</code>
                  <CopyButton text={MCP_URL} />
                </div>
                <p className="text-xs text-neutral-500">
                  Same URL for every user — ChatGPT signs you into your own EvolveRun account via
                  OAuth in the next step.
                </p>
              </div>
            </CardContent>
          </Card>

          {/* ── Step 2 — Add to ChatGPT ───────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={2} />
                Add to ChatGPT
              </CardTitle>
              <CardDescription>
                Open ChatGPT&apos;s advanced app settings, enable Developer mode, create a new
                app, paste the URL, and approve access when prompted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <a
                href="https://chatgpt.com/settings"
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants()}
              >
                Open ChatGPT Settings →
              </a>
            </CardContent>
          </Card>

          {/* ── Step 3 — Start chatting ───────────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StepNumber n={3} />
                Start chatting
              </CardTitle>
              <CardDescription>
                Open a new chat, tap +, choose EvolveRun, and start asking about your training.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {SAMPLE_PROMPTS.map((prompt) => (
                  <li
                    key={prompt}
                    className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2"
                  >
                    <span className="truncate text-sm text-neutral-700">{prompt}</span>
                    <CopyButton text={prompt} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
