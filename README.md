# llm-monitor (`llmon`)

A one-shot terminal dashboard for every Claude Code / Codex account registered on your machine — usage and rate limits, checked in parallel with a single command. Authentication warnings appear when expiry is within 3 days or authentication needs attention.

```
llmon · 5 accounts (4 claude · 1 codex) · 09/17 12:55 · 0.6s

╭─ CLAUDE · default ──────────────────────────╮  ╭─ CLAUDE · personal ─────────────────────────╮  ╭─ CLAUDE · research ─────────────────────────╮
│ me@example.com                              │  │ alice@home.example                          │  │ alice@lab.example                           │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │  │ ! re-login in 2d                            │  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   ░░░░░░░░░░░░░░   3%  4h 50m       │  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │  │ Session   ░░░░░░░░░░░░░░   0%  idle         │
│ Weekly    ████░░░░░░░░░░  30%  resets 6d 1h │  │ Session   ██░░░░░░░░░░░░  12%  2h 30m       │  │ Weekly    ░░░░░░░░░░░░░░   0%  idle         │
╰─────────────────────────────────────────────╯  │ Weekly    ███░░░░░░░░░░░  21%  resets 3d 2h │  ╰─────────────────────────────────────────────╯
                                                 ╰─────────────────────────────────────────────╯
╭─ CLAUDE · work ─────────────────────────────╮  ╭─ CODEX · work ──────────────────────────────╮
│ alice@example.com                           │  │ alice@example.com                           │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   ██████░░░░░░░░  46%  2h 10m       │  │ Weekly    ███░░░░░░░░░░░  24%  resets 4d 3h │
│ Weekly    ██████░░░░░░░░  43%  resets 18h   │  │ last activity 9h 20m ago (09/17 03:35)      │
│ Wk Opus   ███████████░░░  77%  resets 18h   │  ╰─────────────────────────────────────────────╯
╰─────────────────────────────────────────────╯

! claude/personal: re-login needed within 2d
! claude/work: Wk Opus at 77%
```

It runs once, checks all accounts concurrently, prints, and exits.

## Display

Accounts are ordered by provider (Claude, then Codex), with the default account first and the rest sorted by label. Each card shows the account email and usage windows.

| Terminal width (characters) | Cards per row |
|---|---|
| Below 96 | 1 |
| 96–144 | 2 |
| 145 or more | 3 |

The layout is chosen on each run. Use `-1` to force one card per row. `COLUMNS` can override the detected terminal width.

Authentication details stay hidden while healthy. Warnings appear starting 3 days before the Claude re-login deadline or Codex token expiry, including exactly 3 days remaining. Expired credentials, stale tokens, and logged-out accounts also show warnings. Claude access tokens normally refresh automatically, so their routine expiry and refresh timestamps are hidden.

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
llmon                 # all accounts: claude, then codex
llmon -c              # claude only (same as `llmon claude`)
llmon --codex         # codex only
llmon work personal   # filter by label substring (multiple = OR)
llmon -c work         # options and filters combine
llmon --json          # machine-readable output for scripts
llmon -1              # force single-column layout (default: auto 1–3 columns)
llmon --no-refresh    # strictly read-only: never refresh tokens
llmon --no-color
llmon -t 5            # network timeout in seconds (default 10)
```

## How it works

**Claude** — reads the OAuth credential from the macOS Keychain (service `Claude Code-credentials-<first 8 hex of sha256(configDir)>`; the default dir uses the bare name), falling back to `<dir>/.credentials.json` on other platforms. Usage comes from `api.anthropic.com/api/oauth/usage` — the same endpoint the `/usage` screen in Claude Code calls — giving session / weekly / per-model weekly windows with reset times. A window whose reset time has already passed shows `window ended`, and a 0% window with no reset time shows `idle — starts on use`.

- Auth expiry: `refreshTokenExpiresAt` is the re-login deadline; a warning appears when it is within 3 days or already expired.

**Codex** — decodes the JWTs in `auth.json` for email and access-token expiry, and reads the last `rate_limits` event from recent session logs (`sessions/YYYY/MM/DD/rollout-*.jsonl`) — the same data the TUI `/status` shows. Since that data is only as fresh as the last session, its timestamp is shown as `last activity`, and windows whose reset time has passed are marked `window ended`.

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
