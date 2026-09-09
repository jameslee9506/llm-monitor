# llm-monitor (`llmon`)

A one-shot terminal dashboard for every Claude Code / Codex account registered on your machine — usage, rate limits, plan, and auth expiry, checked in parallel with a single command. Claude accounts are laid out in three lanes by where their 7-day weekly window stands, so the account to use next is obvious at a glance.

```
llmon · 5 accounts (4 claude · 1 codex) · 09/09 12:55 · 0.6s

── ◔ RESET SOON · 1 · weekly resets within 1d ──────────────────────────────────────────────────
╭─ CLAUDE · work ─────────────────────────────╮
│ alice@example.com                   Max 20x │
│ ✓ auth ok · login to 10/05 (in 25d 19h)     │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   ██████░░░░░░░░  46%  2h 10m       │
│ Weekly    ██████░░░░░░░░  43%  resets 18h   │
│ Wk Opus   ███████████░░░  77%  resets 18h   │
╰─────────────────────────────────────────────╯

── ◑ MID-WEEK · 1 · weekly resets in 1–5d ──────────────────────────────────────────────────────
╭─ CLAUDE · personal ─────────────────────────╮
│ alice@home.example                  Max 20x │
│ ✓ auth ok · login to 10/19 (in 40d)         │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   ██░░░░░░░░░░░░  12%  2h 30m       │
│ Weekly    ███░░░░░░░░░░░  21%  resets 3d 2h │
╰─────────────────────────────────────────────╯

── ● FRESH · 2 · weekly resets in 5d+, or idle ─────────────────────────────────────────────────
╭─ CLAUDE · default ──────────────────────────╮  ╭─ CLAUDE · research ─────────────────────────╮
│ me@example.com                      Max 20x │  │ alice@lab.example                   Max 20x │
│ ✓ auth ok · login to 09/21 (in 12d)         │  │ ✓ auth ok · login to 10/31 (in 52d)         │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   ░░░░░░░░░░░░░░   3%  4h 50m       │  │ Session   ░░░░░░░░░░░░░░   0%  idle         │
│ Weekly    ████░░░░░░░░░░  30%  resets 6d 1h │  │ Weekly    ░░░░░░░░░░░░░░   0%  idle         │
╰─────────────────────────────────────────────╯  ╰─────────────────────────────────────────────╯

── CODEX · 1 ───────────────────────────────────────────────────────────────────────────────────
╭─ CODEX · work ──────────────────────────────╮
│ alice@example.com               ChatGPT Pro │
│ ✓ auth ok · token to 09/13 (in 4d 10h)      │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Weekly    ███░░░░░░░░░░░  24%  resets 4d 3h │
│ last activity 9h 20m ago (09/09 03:35)      │
╰─────────────────────────────────────────────╯

! claude/work: Wk Opus at 77%
```

Not a live monitor — it runs once, fans out over all accounts concurrently, prints, and exits.

## Lanes (Claude)

Claude Code has two rolling limits: a 5-hour session window and a 7-day weekly window (plus per-model weekly windows such as `Wk Opus`). On a multi-account setup the weekly limit is the one that actually runs out — the session window comes back within hours, the weekly one takes days — so `llmon` puts each Claude account in one of three lanes by how long its **weekly** window has left:

| Lane | Time until the weekly window resets |
|---|---|
| `◔ RESET SOON` | 1 day or less — the weekly quota comes back tomorrow, so spend what's left |
| `◑ MID-WEEK` | between 1 and 5 days |
| `● FRESH` | 5 days or more (the week started less than 2 days ago), or **idle** — no active weekly window at all (0% used, no reset time); it starts on use |

All three lanes are always printed, so an empty `RESET SOON` lane is information too. Within a lane, accounts are ordered by time-to-reset (soonest first, idle last). Claude accounts whose usage couldn't be fetched (not logged in, network error) trail in a `NO DATA` group. `--json` carries the same classification per account as `"lane"`: `"soon"`, `"mid"`, `"fresh"`, or `null`.

The lane is driven by the all-models `Weekly` row; per-model weekly rows (`Wk Opus`, …) share its reset time, and the `Session` row is shown for reference only. Thresholds live in `src/lanes.js` (`SOON_MS`, `FRESH_MS`).

Codex accounts are not laned — their rate-limit data comes from session logs rather than a live endpoint, so a phase would only be as fresh as the last session — and are listed after the Claude lanes under their own header.

## Account discovery

Multi-account setups keep one config home per account (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`). `llmon` scans:

| Provider | Directory | Counts as an account when |
|---|---|---|
| claude | `~/.claude-<label>` | `<dir>/.claude.json` exists |
| claude (default) | `~/.claude` | `~/.claude.json` exists in `$HOME` |
| codex | `~/.codex-<label>` | `<dir>/auth.json` exists |
| codex (default) | `~/.codex` | `auth.json` exists |

Matching directories that aren't accounts (e.g. a browser profile named `~/.claude-something`) are listed as skipped.

## Usage

```sh
llmon                 # all accounts: claude lanes, then codex
llmon -c              # claude only (same as `llmon claude`)
llmon --codex         # codex only
llmon work personal   # filter by label substring (multiple = OR)
llmon -c work         # options and filters combine
llmon --json          # machine-readable output for scripts (includes "lane")
llmon -1              # single-column layout (auto below 96 columns)
llmon --no-refresh    # strictly read-only: never refresh tokens
llmon --no-color
llmon -t 5            # network timeout in seconds (default 10)
```

## How it works

**Claude** — reads the OAuth credential from the macOS Keychain (service `Claude Code-credentials-<first 8 hex of sha256(configDir)>`; the default dir uses the bare name), falling back to `<dir>/.credentials.json` on other platforms. Usage comes from `api.anthropic.com/api/oauth/usage` — the same endpoint the `/usage` screen in Claude Code calls — giving session / weekly / per-model weekly windows with reset times. The **Weekly** row is what drives the lanes (see above) and the **Session** row is shown for reference; a window whose reset time has already passed shows `window ended`, and a 0% window with no reset time shows `idle — starts on use`.

- Plan comes from `rateLimitTier` (e.g. `default_claude_max_20x` → `Max 20x`).
- Auth expiry: `refreshTokenExpiresAt` is the re-login deadline shown as `login to …`; the short-lived access token normally renews itself.

**Codex** — decodes the JWTs in `auth.json` for email / plan / access-token expiry, and reads the last `rate_limits` event from recent session logs (`sessions/YYYY/MM/DD/rollout-*.jsonl`) — the same data the TUI `/status` shows. Since that data is only as fresh as the last session, its timestamp is shown as `last activity`, and windows whose reset time has passed are marked `window ended`.

### Token auto-refresh (Claude)

If a stored Claude access token is expired (common for accounts you haven't used in a while), `llmon` performs the standard OAuth refresh grant against `console.anthropic.com/v1/oauth/token` — exactly what Claude Code does on launch — and writes the result (including a rotated refresh token) back to the same Keychain item / credentials file. Failure modes are conservative:

- Refresh throttled or errored → the stored token is still tried as-is; nothing is written.
- Refresh token rejected (`invalid_grant`) → shown as `re-login required`; nothing is written.
- Disable entirely with `--no-refresh`.

Codex tokens are never touched: the codex CLI refreshes itself on next run, and no usage data depends on a live codex token.

## Security notes

- Reads credentials only from the standard local locations above; writes only when persisting a Claude token refresh, and only to the same item it read.
- Talks to exactly two hosts, both official: `api.anthropic.com` (usage) and `console.anthropic.com` (token refresh). No telemetry, no third-party services.
- Tokens never appear in output (including `--json`), logs, or process arguments (Keychain writes go through `security -i` on stdin).
- The OAuth `client_id` in the source is Claude Code's public PKCE client identifier, not a secret.
- `--json` output does contain your account emails and home paths — mind that before piping it somewhere public.

## Install

Requires Node ≥ 18. Zero dependencies.

```sh
git clone https://github.com/jameslee9506/llm-monitor.git && cd llm-monitor
mkdir -p ~/.local/bin
ln -sf "$(pwd)/bin/llmon.js" ~/.local/bin/llmon   # ensure ~/.local/bin is in PATH
```

(`npm link` works too if your global npm prefix is user-writable.)

Uninstall: `rm ~/.local/bin/llmon`

## License

MIT
