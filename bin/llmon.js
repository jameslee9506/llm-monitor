#!/usr/bin/env node
import { discover } from '../src/discover.js';
import { checkClaude } from '../src/claude.js';
import { checkCodex } from '../src/codex.js';
import { render } from '../src/render.js';
import { state } from '../src/util.js';

const VERSION = '0.2.0';
const HELP = `llmon ${VERSION} — one-shot dashboard for local Claude Code & Codex accounts

Scans ~/.claude(-*) and ~/.codex(-*) config homes, checks all accounts in
parallel: usage / rate limits, plan, auth expiry & refresh dates. Expired
Claude access tokens are auto-refreshed (standard OAuth refresh grant) and
saved back where Claude Code keeps them.

Usage: llmon [filters...] [options]

Filters:  provider name (claude, codex) or account label substring
          e.g.  llmon claude       llmon work personal

Options:
  -1, --one-column     Single-column layout
      --json           Machine-readable JSON output
      --no-color       Disable colors
      --no-refresh     Never refresh tokens (strictly read-only)
  -t, --timeout <sec>  Network timeout per request (default 10)
  -h, --help           Show this help
  -v, --version        Show version

Data sources:
  claude  Keychain/file OAuth creds + api.anthropic.com/api/oauth/usage (same as /usage)
  codex   auth.json JWT claims + rate_limits events in session logs (same as /status)`;

function parseArgs(argv) {
  const a = { filters: [], json: false, oneCol: false, noColor: false, noRefresh: false, timeout: 10 };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s === '--json') a.json = true;
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
  let targets = accounts;
  if (args.filters.length) {
    targets = accounts.filter((a) =>
      args.filters.some((f) => a.provider === f || a.label.toLowerCase().includes(f))
    );
  }
  if (!targets.length) {
    console.error(args.filters.length ? 'no accounts match the filter' : 'no ~/.claude* or ~/.codex* accounts found');
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

  const order = { claude: 0, codex: 1 };
  results.sort(
    (a, b) =>
      order[a.provider] - order[b.provider] ||
      (a.label === 'default' ? '' : a.label).localeCompare(b.label === 'default' ? '' : b.label)
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
