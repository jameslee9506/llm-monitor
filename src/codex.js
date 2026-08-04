import { readFile, readdir, open } from 'node:fs/promises';
import { join } from 'node:path';

function jwtPayload(tok) {
  try {
    return JSON.parse(Buffer.from(tok.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// Newest-first walk of sessions/YYYY/MM/DD/rollout-*.jsonl.
// Date-shaped dir names and timestamped file names sort lexicographically.
async function newestFiles(root, want) {
  const out = [];
  async function walk(d, depth) {
    if (out.length >= want || depth > 4) return;
    let ents;
    try {
      ents = await readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    const files = ents.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => e.name).sort().reverse();
    const dirs = ents.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    for (const f of files) {
      out.push(join(d, f));
      if (out.length >= want) return;
    }
    for (const dn of dirs) {
      await walk(join(d, dn), depth + 1);
      if (out.length >= want) return;
    }
  }
  await walk(root, 0);
  return out;
}

async function tailText(path, bytes) {
  const fh = await open(path, 'r');
  try {
    const size = (await fh.stat()).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const i = text.indexOf('\n');
      text = i >= 0 ? text.slice(i + 1) : '';
    }
    return text;
  } finally {
    await fh.close();
  }
}

function windowLabel(wm, fallback) {
  if (wm === 300) return '5h limit';
  if (wm === 10080) return 'Weekly';
  if (!wm) return fallback;
  return wm % 1440 === 0 ? `${wm / 1440}d limit` : `${Math.round(wm / 60)}h limit`;
}

// The codex TUI /status data: last rate_limits event in recent session logs.
async function latestRateLimits(dir) {
  const files = await newestFiles(join(dir, 'sessions'), 8);
  for (const p of files) {
    let text;
    try {
      text = await tailText(p, 262144);
    } catch {
      continue;
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let obj;
      try {
        obj = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      const rl = obj?.payload?.rate_limits ?? obj?.rate_limits;
      if (!rl) continue;
      const asOf = obj.timestamp ? Date.parse(obj.timestamp) : null;

      const windows = [];
      for (const k of ['primary', 'secondary']) {
        const w = rl[k];
        if (!w || typeof w.used_percent !== 'number') continue;
        let resetsAt = null;
        if (typeof w.resets_at === 'number') resetsAt = w.resets_at * 1000;
        else if (typeof w.resets_in_seconds === 'number' && asOf) resetsAt = asOf + w.resets_in_seconds * 1000;
        windows.push({
          key: k,
          label: windowLabel(w.window_minutes, cap(k)),
          pct: w.used_percent,
          resetsAt,
          severity: 'normal',
          active: false,
          ended: resetsAt ? resetsAt < Date.now() : false,
        });
      }
      if (!windows.length && typeof rl.primary_used_percent === 'number') {
        windows.push({ key: 'primary', label: '5h limit', pct: rl.primary_used_percent, resetsAt: null, severity: 'normal', active: false, ended: false });
        if (typeof rl.secondary_used_percent === 'number')
          windows.push({ key: 'secondary', label: 'Weekly', pct: rl.secondary_used_percent, resetsAt: null, severity: 'normal', active: false, ended: false });
      }
      if (!windows.length) continue;

      return {
        windows,
        asOf,
        planType: rl.plan_type ?? null,
        credits: rl.credits?.has_credits ? rl.credits.balance : null,
      };
    }
  }
  return null;
}

export async function checkCodex(acct) {
  const out = {
    provider: 'codex',
    label: acct.label,
    dir: acct.dir,
    email: null,
    org: null,
    plan: null,
    auth: { loggedIn: false, accessExpiresAt: null, lastRefreshAt: null, stale: false, method: null },
    usage: null,
    notes: [],
    error: null,
  };

  let auth;
  try {
    auth = JSON.parse(await readFile(join(acct.dir, 'auth.json'), 'utf8'));
  } catch {
    out.error = 'auth.json unreadable';
    return out;
  }

  if (auth?.OPENAI_API_KEY) {
    out.auth.loggedIn = true;
    out.auth.method = 'api-key';
    out.plan = 'API key';
  }
  const t = auth?.tokens;
  if (t?.id_token || t?.access_token) {
    out.auth.loggedIn = true;
    out.auth.method = 'chatgpt';
    const id = jwtPayload(t.id_token || '');
    const ac = jwtPayload(t.access_token || '');
    const claim = id?.['https://api.openai.com/auth'] || ac?.['https://api.openai.com/auth'] || {};
    out.email = id?.email ?? null;
    if (claim.chatgpt_plan_type) out.plan = `ChatGPT ${cap(claim.chatgpt_plan_type)}`;
    const exp = ac?.exp ?? id?.exp;
    if (exp) out.auth.accessExpiresAt = exp * 1000;
    if (out.auth.accessExpiresAt && out.auth.accessExpiresAt < Date.now()) out.auth.stale = true;
  }
  if (auth?.last_refresh) {
    const ts = Date.parse(auth.last_refresh);
    if (!Number.isNaN(ts)) out.auth.lastRefreshAt = ts;
  }
  if (!out.auth.loggedIn) {
    out.error = 'not logged in';
    return out;
  }

  try {
    out.usage = await latestRateLimits(acct.dir);
  } catch {}
  if (!out.plan && out.usage?.planType) out.plan = `ChatGPT ${cap(out.usage.planType)}`;
  return out;
}
