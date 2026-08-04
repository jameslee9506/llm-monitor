# llm-monitor (`llmon`)

A one-shot terminal dashboard for every Claude Code / Codex account registered on your machine — usage, rate limits, plan, and auth expiry, checked in parallel with a single command.

```
llmon · 4 accounts (2 claude · 2 codex) · 08/04 09:15 · 0.6s

╭─ CLAUDE · work ─────────────────────────╮  ╭─ CODEX · work ──────────────────────────╮
│ alice@example.com               Max 20x │  │ alice@example.com           ChatGPT Pro │
│ ✓ auth ok · login to 08/30 (in 25d 19h) │  │ ✓ auth ok · token to 08/08 (in 4d 10h)  │
│ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │  │ ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
│ Session   █░░░░░░░░░░░   7%  resets 4h  │  │ Weekly    ███░░░░░░░░  24%  resets 4d   │
│ Weekly    ██████░░░░░░  43%  resets 3d  │  │ last activity 9h ago (08/04 00:06)      │
│ Wk Opus   ███████████░  77%  resets 3d  │  ╰─────────────────────────────────────────╯
╰─────────────────────────────────────────╯

! claude/work: Wk Opus at 77%
```

Not a live monitor — it runs once, fans out over all accounts concurrently, prints, and exits.

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
llmon                 # all accounts, two-column dashboard
llmon claude          # filter by provider
llmon work personal   # filter by label substring (multiple = OR)
llmon --json          # machine-readable output for scripts
llmon -1              # single-column layout (auto below 96 columns)
llmon --no-refresh    # strictly read-only: never refresh tokens
llmon --no-color
llmon -t 5            # network timeout in seconds (default 10)
```

## How it works

**Claude** — reads the OAuth credential from the macOS Keychain (service `Claude Code-credentials-<first 8 hex of sha256(configDir)>`; the default dir uses the bare name), falling back to `<dir>/.credentials.json` on other platforms. Usage comes from `api.anthropic.com/api/oauth/usage` — the same endpoint the `/usage` screen in Claude Code calls — giving session / weekly / per-model weekly windows with reset times.

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
