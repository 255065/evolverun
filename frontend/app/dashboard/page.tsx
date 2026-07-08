import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { loadActivitySummary } from "./actions";
import {
  connectProviderAction,
  disconnectProviderAction,
  getConnectionStatus,
} from "./connections/actions";
import { getConnectorStatus, listKeys } from "./mcp/actions";
import { CopyButton } from "./copy-button";
import { LatestActivityCard } from "./latest-activity-card";

export const dynamic = "force-dynamic";

const QUICK_PROMPTS = [
  "How did this week compare to last?",
  "Am I ready for tomorrow's long run?",
  "Plan my next 7 days around a tempo Tuesday.",
  "Why was last Saturday's long run so hard?",
  "Am I training polarized or stuck in the grey zone?",
  "Write me a 12-week marathon plan based on my last 3 months of data.",
];

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const athleteName = (user?.user_metadata?.full_name ?? "").trim() || "Athlete";
  const firstName = athleteName.split(" ")[0] || "athlete";

  const [strava, summary, connector, keys] = await Promise.all([
    getConnectionStatus("strava"),
    loadActivitySummary(),
    getConnectorStatus(),
    listKeys(),
  ]);

  const connected = strava?.connected ?? false;
  const latest = summary?.latest ?? null;
  const week = summary?.week ?? { activities: 0, km: 0, hours: 0 };
  const claudeConnected = connector.claude_connected;
  const chatgptConnected = keys.some((k) => !k.revoked_at);
  const connectorAdded = claudeConnected || chatgptConnected;

  return (
    <>
      <h1 className="evr-headline text-[clamp(40px,6vw,64px)] leading-[1] tracking-[-0.03em]">
        Dashboard
      </h1>
      <p className="mt-4 text-[15px] text-neutral-600">
        Welcome back, <span className="capitalize">{firstName}</span>.
      </p>

      {/* Setup checklist — shown until Strava + a connector are both live */}
      {!(connected && connectorAdded) && (
        <div className="mt-10 rounded-2xl border border-neutral-200 bg-white px-5 py-5">
          <SectionLabel>Get set up</SectionLabel>
          <ul className="mt-4 space-y-3">
            <ChecklistStep
              n={1}
              done={connected}
              label="Connect Strava"
              action={{ label: "Connect", href: "/dashboard/connections" }}
            />
            <ChecklistStep
              n={2}
              done={connectorAdded}
              label="Add EvolveRun to Claude or ChatGPT"
              action={{ label: "Open setup", href: "/dashboard/mcp" }}
            />
            <ChecklistStep
              n={3}
              done={false}
              label="Ask your first question"
              action={{ label: "See prompts", href: "#prompts" }}
            />
          </ul>
        </div>
      )}

      {/* Connected sources */}
      <SectionLabel className="mt-16">Connected sources</SectionLabel>
      <Row
        icon={
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#fc5200]">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#fff">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
        }
        title="Strava"
        desc={
          connected
            ? "Listening for new activities"
            : "Link Strava to sync your runs"
        }
        right={
          connected ? (
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-[12px] font-medium text-emerald-700">
                Synced
              </span>
              <form action={disconnectProviderAction}>
                <input type="hidden" name="provider" value="strava" />
                <button type="submit" className="text-[13px] text-neutral-500 hover:text-neutral-950">
                  Disconnect
                </button>
              </form>
            </div>
          ) : (
            <form action={connectProviderAction}>
              <input type="hidden" name="provider" value="strava" />
              <button
                type="submit"
                className="rounded-md bg-neutral-950 px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-neutral-800"
              >
                Connect
              </button>
            </form>
          )
        }
      />

      {/* AI coach */}
      <SectionHeader label="AI coach" action="Open setup" href="/dashboard/mcp" />
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <CoachCard
          name="Claude"
          logo={<ClaudeLogo />}
          bg="#fde2d4"
          href="/dashboard/mcp?assistant=claude"
          connected={claudeConnected}
        />
        <CoachCard
          name="ChatGPT"
          logo={<ChatGPTLogo />}
          bg="#d6f0e2"
          href="/dashboard/mcp?assistant=chatgpt"
          connected={chatgptConnected}
        />
      </div>

      {/* Latest activity */}
      <SectionLabel className="mt-16">Latest activity</SectionLabel>
      <div className="mt-4">
        {latest ? (
          <LatestActivityCard latest={latest} athleteName={athleteName} />
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white px-5 py-6 text-[13.5px] text-neutral-500">
            No activities yet. Your latest run will appear here once Strava finishes its first sync.
          </div>
        )}
      </div>

      {/* This week */}
      <SectionLabel className="mt-16">This week</SectionLabel>
      <div className="mt-4 grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard label="Activities" value={String(week.activities)} />
        <StatCard label="Total km" value={week.km.toFixed(1)} />
        <StatCard label="Total hours" value={week.hours.toFixed(1)} />
      </div>

      {/* Quick prompts */}
      <div id="prompts" className="scroll-mt-24">
        <SectionHeader label="Quick prompts" action="Connector setup" href="/dashboard/mcp" />
      </div>
      <p className="mt-4 text-[15px] text-neutral-700">
        Copy any of these into Claude.ai or ChatGPT once the EvolveRun connector is attached.
      </p>
      <div className="mt-6 space-y-3">
        {QUICK_PROMPTS.map((p) => (
          <div
            key={p}
            className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-5 py-3"
          >
            <div className="min-w-0 text-[14.5px] text-neutral-800">{p}</div>
            <span className="shrink-0">
              <CopyButton text={p} />
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────

function SectionLabel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ label, action, href }: { label: string; action: string; href: string }) {
  return (
    <div className="mt-16 flex items-end justify-between">
      <SectionLabel>{label}</SectionLabel>
      <Link href={href} className="text-[13px] font-medium text-[#dc6b3f] hover:underline">
        {action}
      </Link>
    </div>
  );
}

function Row({
  icon,
  title,
  desc,
  right,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  right: React.ReactNode;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-4 sm:px-5">
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        {icon}
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">{title}</div>
          <div className="text-[13px] text-neutral-600">{desc}</div>
        </div>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3.5 sm:p-5">
      {/* Reserve ~2 label lines on mobile so the values align even when a
          label like "Total hours" wraps in the narrow column. */}
      <div className="flex min-h-[2.5em] items-start font-mono text-[9.5px] uppercase leading-tight tracking-[0.08em] text-neutral-500 sm:min-h-0 sm:text-[10.5px] sm:tracking-[0.16em]">
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold tracking-[-0.02em] sm:mt-2 sm:text-[28px]">{value}</div>
    </div>
  );
}

function CoachCard({
  name,
  logo,
  bg,
  href,
  connected,
}: {
  name: string;
  logo: React.ReactNode;
  bg: string;
  href: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-200 bg-white px-5 py-5">
      <div className="flex min-w-0 items-center gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: bg }}>
          {logo}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[15.5px] font-semibold">
            {name}
            {connected && (
              <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                Connected
              </span>
            )}
          </div>
        </div>
      </div>
      <Link
        href={href}
        className="shrink-0 whitespace-nowrap rounded-md border border-neutral-300 bg-white px-3.5 py-1.5 text-[13px] font-medium text-neutral-950 hover:bg-neutral-50"
      >
        {connected ? "Manage" : "Add"}
      </Link>
    </div>
  );
}

function ChecklistStep({
  n,
  done,
  label,
  action,
}: {
  n: number;
  done: boolean;
  label: string;
  action: { label: string; href: string };
}) {
  return (
    <li className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {done ? (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-9" />
            </svg>
          </span>
        ) : (
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#dc6b3f] text-xs font-semibold text-white">
            {n}
          </span>
        )}
        <span className={"min-w-0 text-[14.5px] " + (done ? "text-neutral-400 line-through" : "text-neutral-800")}>
          {label}
        </span>
      </div>
      {!done && (
        <Link href={action.href} className="shrink-0 whitespace-nowrap text-[13px] font-medium text-[#dc6b3f] hover:underline">
          {action.label} →
        </Link>
      )}
    </li>
  );
}

function ClaudeLogo() {
  return <Image src="/claude-symbol.png" alt="Claude" width={24} height={24} className="h-6 w-6" />;
}

function ChatGPTLogo() {
  // Official OpenAI logomark.
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="#0d0d0d" aria-label="ChatGPT">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071.006l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071-.006l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
    </svg>
  );
}
