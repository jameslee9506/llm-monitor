// Claude accounts are grouped into three lanes by where their 7-day weekly
// window sits in its cycle, answering "which account should I use next?".
// On a multi-account setup the weekly limit — not the 5-hour session — is what
// actually runs out, so its reset time is the one worth planning around:
//   RESET SOON   weekly window resets within SOON_MS (1 day)
//   MID-WEEK     everything in between
//   FRESH        ≥ FRESH_MS (5 days) until reset — the week started less than
//                2 days ago — or idle: no active window (0% used, no reset time)
// Codex accounts are not laned: their rate-limit data is read from session
// logs, not a live endpoint, so a phase classification would be stale.
const DAY_MS = 24 * 60 * 60 * 1000;
export const SOON_MS = 1 * DAY_MS;
export const FRESH_MS = 5 * DAY_MS;

export const LANES = [
  { id: 'soon', icon: '◔', name: 'RESET SOON', sub: 'weekly resets within 1d' },
  { id: 'mid', icon: '◑', name: 'MID-WEEK', sub: 'weekly resets in 1–5d' },
  { id: 'fresh', icon: '●', name: 'FRESH', sub: 'weekly resets in 5d+, or idle' },
];
// Claude accounts with no weekly-window data (not logged in, fetch failed).
export const NO_DATA = { id: null, icon: '○', name: 'NO DATA', sub: 'no usage data' };

// The all-models weekly window (`weekly_all` from /api/oauth/usage, `seven_day`
// in the legacy shape). Per-model weekly windows (`weekly_scoped`, `seven_day_opus`,
// …) share its reset time, so one of them serves as a fallback if it is missing.
export function weeklyWindow(a) {
  const ws = a.usage?.windows;
  if (!ws?.length) return null;
  return (
    ws.find((w) => w.key === 'weekly_all' || w.key === 'seven_day' || w.label === 'Weekly') ??
    ws.find((w) => /^(weekly|seven_day)/.test(String(w.key))) ??
    null
  );
}

// Milliseconds until the weekly window resets. Infinity when no window is
// active (idle account); null when there is no usage data at all.
export function weeklyLeft(a, now = Date.now()) {
  const w = weeklyWindow(a);
  if (!w) return null;
  if (!w.resetsAt || w.resetsAt <= now) return Infinity;
  return w.resetsAt - now;
}

export function laneOf(a, now = Date.now()) {
  if (a.provider !== 'claude') return null;
  const left = weeklyLeft(a, now);
  if (left === null) return null;
  if (left <= SOON_MS) return 'soon';
  if (left >= FRESH_MS) return 'fresh';
  return 'mid';
}

// Sort position of a lane id; unknown/null sorts after the three lanes.
export function laneRank(id) {
  const i = LANES.findIndex((l) => l.id === id);
  return i < 0 ? LANES.length : i;
}
