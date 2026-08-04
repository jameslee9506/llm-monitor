import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { userInfo } from 'node:os';

// Same endpoints Claude Code itself uses: /usage screen data + OAuth token refresh.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
// Claude Code's public OAuth client id (PKCE public client — not a secret).
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const UA = 'llmon (llm-monitor CLI)';

// macOS keychain service is "Claude Code-credentials-<first 8 hex of sha256(configDir)>";
// the default config dir uses the bare service name.
function keychainService(acct) {
  if (acct.service) return acct.service;
  const h = createHash('sha256').update(acct.dir).digest('hex').slice(0, 8);
  return `Claude Code-credentials-${h}`;
}

function keychainRead(service) {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve(null);
      }
    });
  });
}

// Update the credential item in place. Uses `security -i` (commands over stdin)
// so the token payload never appears in the process argument list.
function keychainWrite(service, account, json) {
  return new Promise((resolve) => {
    const child = execFile('security', ['-i'], { timeout: 8000 }, (err, _stdout, stderr) =>
      resolve(err ? stderr?.trim() || err.message : null)
    );
    child.stdin.on('error', () => {});
    child.stdin.write(`add-generic-password -U -s '${service}' -a '${account}' -w '${json}'\n`);
    child.stdin.end();
  });
}

// Returns { creds, source, container } — container is the full stored JSON so
// unknown sibling fields survive a write-back.
async function readCreds(acct) {
  if (process.platform === 'darwin') {
    const kc = await keychainRead(keychainService(acct));
    if (kc?.claudeAiOauth) return { creds: kc.claudeAiOauth, source: 'keychain', container: kc };
  }
  try {
    const f = JSON.parse(await readFile(join(acct.dir, '.credentials.json'), 'utf8'));
    if (f?.claudeAiOauth) return { creds: f.claudeAiOauth, source: 'file', container: f };
  } catch {}
  return { creds: null };
}

async function persistCreds(acct, source, container, creds) {
  const json = JSON.stringify({ ...container, claudeAiOauth: creds });
  if (source === 'keychain') {
    const account = userInfo().username;
    if ([json, account].some((s) => s.includes("'"))) return 'unexpected quote in payload';
    return keychainWrite(keychainService(acct), account, json);
  }
  try {
    await writeFile(join(acct.dir, '.credentials.json'), json, { mode: 0o600 });
    return null;
  } catch (e) {
    return e.message;
  }
}

// Standard OAuth refresh-token grant, persisted back where the CLI keeps it
// (including a rotated refresh token, if the server returns one).
async function refreshCreds(acct, source, container, creds, timeoutMs) {
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: CLIENT_ID }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { error: e.name === 'TimeoutError' ? 'timeout' : e?.cause?.code || e.message };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    const kind = body?.error === 'invalid_grant' || body?.error?.type === 'invalid_grant' ? 're-login required' : `HTTP ${res.status}`;
    return { error: kind };
  }
  if (typeof body?.access_token !== 'string') return { error: 'malformed token response' };
  const updated = {
    ...creds,
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : creds.refreshToken,
    expiresAt: Date.now() + (typeof body.expires_in === 'number' ? body.expires_in : 28800) * 1000,
  };
  const persistErr = await persistCreds(acct, source, container, updated);
  return { creds: updated, persistErr };
}

function planLabel(creds) {
  const m = (creds.rateLimitTier || '').match(/max_(\d+)x/);
  if (m) return `Max ${m[1]}x`;
  const st = creds.subscriptionType;
  return st ? st[0].toUpperCase() + st.slice(1) : null;
}

const KIND_LABEL = {
  session: 'Session',
  weekly_all: 'Weekly',
  weekly_scoped: 'Wk Opus',
  weekly_opus: 'Wk Opus',
  weekly_sonnet: 'Wk Sonnet',
};

function normalizeUsage(body) {
  const windows = [];
  if (Array.isArray(body.limits) && body.limits.length) {
    for (const l of body.limits) {
      if (typeof l?.percent !== 'number') continue;
      const scopeName =
        typeof l.scope === 'string' ? l.scope : l.scope?.model?.display_name ?? l.scope?.model?.id ?? null;
      windows.push({
        key: l.kind,
        label: scopeName ? `Wk ${scopeName}` : KIND_LABEL[l.kind] || String(l.kind || '?').replace(/_/g, ' '),
        pct: l.percent,
        resetsAt: l.resets_at ? Date.parse(l.resets_at) : null,
        severity: l.severity || 'normal',
        active: !!l.is_active,
        ended: false,
      });
    }
  } else {
    const legacy = [
      ['five_hour', 'Session'],
      ['seven_day', 'Weekly'],
      ['seven_day_opus', 'Wk Opus'],
      ['seven_day_sonnet', 'Wk Sonnet'],
    ];
    for (const [k, label] of legacy) {
      const v = body[k];
      if (v && typeof v.utilization === 'number') {
        windows.push({
          key: k,
          label,
          pct: v.utilization,
          resetsAt: v.resets_at ? Date.parse(v.resets_at) : null,
          severity: 'normal',
          active: false,
          ended: false,
        });
      }
    }
  }

  let extra = null;
  const x = body.extra_usage;
  if (x?.is_enabled) {
    const div = 10 ** (x.decimal_places ?? 2);
    extra = {
      used: (x.used_credits ?? 0) / div,
      limit: (x.monthly_limit ?? 0) / div,
      currency: x.currency || 'USD',
    };
  }
  return { windows, extra };
}

async function fetchUsage(token, timeoutMs) {
  try {
    const res = await fetch(USAGE_URL, {
      headers: { Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    let body = null;
    try {
      body = await res.json();
    } catch {}
    return { status: res.status, body };
  } catch (e) {
    return { err: e.name === 'TimeoutError' ? 'timeout' : e?.cause?.code || e.message };
  }
}

export async function checkClaude(acct, { timeoutMs = 10000, allowRefresh = true } = {}) {
  const out = {
    provider: 'claude',
    label: acct.label,
    dir: acct.dir,
    email: null,
    org: null,
    plan: null,
    auth: { loggedIn: false, accessExpiresAt: null, loginExpiresAt: null, stale: false, refreshed: false },
    usage: null,
    notes: [],
    error: null,
  };
  const setFromCreds = (c) => {
    out.plan = planLabel(c);
    out.auth.accessExpiresAt = c.expiresAt ?? null;
    out.auth.loginExpiresAt = c.refreshTokenExpiresAt ?? null;
  };

  const [credsRes, cfgRes] = await Promise.allSettled([readCreds(acct), readFile(acct.cfgPath, 'utf8')]);
  if (cfgRes.status === 'fulfilled') {
    try {
      const oa = JSON.parse(cfgRes.value)?.oauthAccount;
      out.email = oa?.emailAddress ?? null;
      out.org = oa?.organizationName ?? null;
    } catch {}
  }
  const read = credsRes.status === 'fulfilled' ? credsRes.value : { creds: null };
  let creds = read.creds;
  if (!creds) {
    out.error = 'not logged in (no credentials found)';
    return out;
  }
  out.auth.loggedIn = true;
  setFromCreds(creds);

  let refreshErr = null;
  let refreshTried = false;
  const tryRefresh = async () => {
    if (!allowRefresh || refreshTried || !creds.refreshToken) return false;
    refreshTried = true;
    const r = await refreshCreds(acct, read.source, read.container, creds, timeoutMs);
    if (r.creds) {
      creds = r.creds;
      out.auth.refreshed = true;
      setFromCreds(creds);
      if (r.persistErr) out.notes.push(`refreshed token could not be saved (${r.persistErr})`);
      return true;
    }
    refreshErr = r.error;
    return false;
  };

  // Refresh proactively when the stored access token is expired; if that fails
  // (e.g. throttled), still try the stored token — the server is the authority.
  if (!creds.accessToken || (creds.expiresAt && creds.expiresAt < Date.now() + 60000)) await tryRefresh();
  if (!creds.accessToken) {
    out.auth.stale = true;
    out.notes.push(refreshErr ? `no usable token — refresh failed (${refreshErr})` : 'no access token stored');
    return out;
  }

  let res = await fetchUsage(creds.accessToken, timeoutMs);
  if ((res.status === 401 || res.status === 403) && (await tryRefresh())) {
    res = await fetchUsage(creds.accessToken, timeoutMs);
  }
  if (res.err) {
    out.notes.push(`usage fetch failed: ${res.err}`);
  } else if (res.status === 401 || res.status === 403) {
    out.auth.stale = true;
    out.notes.push(
      refreshErr === 're-login required'
        ? 'refresh token rejected — run claude auth login'
        : `token expired — auto-refresh failed${refreshErr ? ` (${refreshErr})` : ''}; run claude once`
    );
  } else if (res.status !== 200) {
    out.notes.push(`usage API HTTP ${res.status}`);
  } else {
    out.usage = normalizeUsage(res.body);
  }
  return out;
}
