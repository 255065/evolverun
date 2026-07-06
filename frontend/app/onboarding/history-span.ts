// Turn the oldest synced activity into a human "N years/months of history"
// span for the onboarding "ready" screen. Returns null when there's nothing
// to describe yet (no synced activities).
export function formatSpan(oldestISO: string | null, now: number = Date.now()): string | null {
  if (!oldestISO) return null;
  const parsed = new Date(oldestISO).getTime();
  if (Number.isNaN(parsed)) return null;
  const days = (now - parsed) / 86_400_000;
  if (days >= 365) {
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? "year" : "years"} of history`;
  }
  if (days >= 60) return `${Math.round(days / 30)} months of history`;
  return "recent history";
}
