#!/usr/bin/env node
import { discover } from '../src/discover.js';
import { checkClaude } from '../src/claude.js';
import { checkCodex } from '../src/codex.js';
import { render } from '../src/render.js';
import { laneOf, laneRank, weeklyLeft } from '../src/lanes.js';
import { state } from '../src/util.js';

const VERSION = '0.4.0';
const HELP = `llmon ${VERSION} — one-shot dashboard for local Claude Code & Codex accounts

Scans ~/.claude(-*) and ~/.codex(-*) config homes, checks all accounts in
parallel: usage / rate limits, plan, auth expiry & refresh dates. Expired
Claude access tokens are auto-refreshed (standard OAuth refresh grant) and
saved back where Claude Code keeps them.

Claude accounts are shown in three lanes by their 7-day weekly window:
  ◔ RESET SOON   weekly resets within 1d
  ◑ MID-WEEK     weekly resets in 1–5d
  ● FRESH        weekly resets in 5d+ (week started <2d ago), or idle

Usage: llmon [filters...] [options]

Filters:  provider name (claude, codex) or account label substring
          e.g.  llmon claude       llmon work personal

Options:
  -c, --claude         Claude accounts only (same as the "claude" filter)
      --codex          Codex accounts only
  -1, --one-column     Single-column layout
      --json           Machine-readable JSON output (each account carries its "lane")
      --no-color       Disable colors
      --no-refresh     Never refresh tokens (strictly read-only)
  -t, --timeout <sec>  Network timeout per request (default 10)
  -h, --help           Show this help
  -v, --version        Show version

Data sources:
  claude  Keychain/file OAuth creds + api.anthropic.com/api/oauth/usage (same as /usage)
  codex   auth.json JWT claims + rate_limits events in session logs (same as /status)`;

function parseArgs(argv) {
  const a = { filters: [], provider: null, json: false, oneCol: false, noColor: false, noRefresh: false, timeout: 10 };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--json') a.json = true;
    else if (s === '-c' || s === '--claude') a.provider = 'claude';
    else if (s === '--codex') a.provider = 'codex';
    else if (s === '-1' || s === '--one-column') a.oneCol = true;
    else if (s === '--no-color') a.noColor = true;
    else if (s === '--no-refresh') a.noRefresh = true;
    else if (s === '-t' || s === '--timeout') a.timeout = Number(argv[++i]) || 10;
    else if (s === '-h' || s === '--help') a.help = true;
    else if (s === '-v' || s === '--version') a.version = true;
    else if (s.startsWith('-')) {
      console.error(`unknown option: ${s} (see llmon --help)`);
      process.exit(2);
    } else a.filters.push(s.toLowerCase());
  }
  return a;
}

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
function spinner(n) {
  if (!process.stderr.isTTY) return () => {};
  let i = 0;
  const iv = setInterval(() => {
    process.stderr.write(`\r${FRAMES[i++ % FRAMES.length]} checking ${n} accounts…`);
  }, 80);
  return () => {
    clearInterval(iv);
    process.stderr.write('\r\x1b[2K');
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.version) return console.log(VERSION);
  state.color = !args.noColor && !process.env.NO_COLOR && (Boolean(process.stdout.isTTY) || Boolean(process.env.FORCE_COLOR));

  const { accounts, skipped } = discover();
  let targets = args.provider ? accounts.filter((a) => a.provider === args.provider) : accounts;
  if (args.filters.length) {
    targets = targets.filter((a) =>
      args.filters.some((f) => a.provider === f || a.label.toLowerCase().includes(f))
    );
  }
  if (!targets.length) {
    console.error(
      args.filters.length
        ? 'no accounts match the filter'
        : args.provider
          ? `no ${args.provider} accounts found`
          : 'no ~/.claude* or ~/.codex* accounts found'
    );
    process.exit(1);
  }

  const stop = args.json ? () => {} : spinner(targets.length);
  const t0 = Date.now();
  const results = await Promise.all(
    targets.map((a) =>
      (a.provider === 'claude'
        ? checkClaude(a, { timeoutMs: args.timeout * 1000, allowRefresh: !args.noRefresh })
        : checkCodex(a)
      ).catch((e) => ({
        provider: a.provider,
        label: a.label,
        dir: a.dir,
        email: null,
        org: null,
        plan: null,
        auth: { loggedIn: false, stale: false },
        usage: null,
        notes: [],
        error: `check failed: ${e.message}`,
      }))
    )
  );
  const elapsedMs = Date.now() - t0;
  stop();

  // Lane = phase of the Claude weekly window (soon / mid / fresh; null for codex or no data).
  const now = Date.now();
  for (const r of results) r.lane = laneOf(r, now);

  // claude before codex; within claude by lane, then soonest reset first (idle last); then label.
  const cmp = (x, y) => (x === y ? 0 : x < y ? -1 : 1);
  const order = { claude: 0, codex: 1 };
  const lbl = (a) => (a.label === 'default' ? '' : a.label);
  results.sort(
    (a, b) =>
      cmp(order[a.provider], order[b.provider]) ||
      cmp(laneRank(a.lane), laneRank(b.lane)) ||
      cmp(weeklyLeft(a, now) ?? Infinity, weeklyLeft(b, now) ?? Infinity) ||
      lbl(a).localeCompare(lbl(b))
  );

  if (args.json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), elapsedMs, accounts: results, skipped }, null, 2));
    return;
  }
  const termW = Number(process.env.COLUMNS) || process.stdout.columns || 100;
  console.log(render(results, { termW, oneCol: args.oneCol, skipped, elapsedMs }));
}

main().catch((e) => {
  console.error(`llmon: ${e.message}`);
  process.exit(1);
});
