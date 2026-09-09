// Claude accounts are grouped into three lanes by where their 5-hour session
// window sits in its cycle, answering "which account should I use next?":
//   RESET SOON   window resets within SOON_MS
//   MID-WINDOW   everything in between
//   FRESH        ≥ FRESH_MS until reset (window started recently), or idle —
//                no active window (usage 0%, no reset time)
// Codex accounts are not laned: their rate-limit data is read from session
// logs, not a live endpoint, so a phase classification would be stale.
export const SOON_MS = 60 * 60 * 1000;
export const FRESH_MS = 4 * 60 * 60 * 1000;

export const LANES = [
  { id: 'soon', icon: '◔', name: 'RESET SOON', sub: 'resets within 1h' },
  { id: 'mid', icon: '◑', name: 'MID-WINDOW', sub: 'resets in 1–4h' },
  { id: 'fresh', icon: '●', name: 'FRESH', sub: 'just started or idle' },
];
// Claude accounts with no session-window data (not logged in, fetch failed).
export const NO_DATA = { id: null, icon: '○', name: 'NO DATA', sub: 'no usage data' };

export function sessionWindow(a) {
  return a.usage?.windows?.find((w) => w.key === 'session' || w.key === 'five_hour' || w.label === 'Session') ?? null;
}

// Milliseconds until the session window resets. Infinity when no window is
// active (idle account); null when there is no usage data at all.
export function sessionLeft(a, now = Date.now()) {
  const s = sessionWindow(a);
  if (!s) return null;
  if (!s.resetsAt || s.resetsAt <= now) return Infinity;
  return s.resetsAt - now;
}

export function laneOf(a, now = Date.now()) {
  if (a.provider !== 'claude') return null;
  const left = sessionLeft(a, now);
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
