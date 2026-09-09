import {
  bold, dim, red, green, yellow, fg,
  padE, padS, truncW, visWidth, relDur, fmtDT, fmtD, fmtT,
} from './util.js';
import { LANES, NO_DATA, laneOf } from './lanes.js';

const PROV = {
  claude: { name: 'CLAUDE', color: fg(208) },
  codex: { name: 'CODEX', color: fg(42) },
};
const LANE_COLOR = { soon: yellow, mid: fg(75), fresh: green };

const LBLW = 10;
const BARW = 14;

function pctColor(pct, severity = 'normal') {
  if (severity === 'exceeded' || severity === 'critical' || pct >= 90) return red;
  if (severity === 'warning' || pct >= 70) return yellow;
  return green;
}

function bar(pct, severity, dimmed) {
  const p = Math.max(0, Math.min(100, pct));
  const filled = Math.round((p / 100) * BARW);
  const body = '█'.repeat(filled) + '░'.repeat(BARW - filled);
  if (dimmed) return dim(body);
  return pctColor(p, severity)('█'.repeat(filled)) + dim('░'.repeat(BARW - filled));
}

// Join parts with " · ", dropping trailing parts that don't fit.
function fitParts(parts, iw) {
  const kept = parts.filter(Boolean);
  if (!kept.length) return '';
  let s = kept[0];
  for (let i = 1; i < kept.length; i++) {
    const t = s + dim(' · ') + kept[i];
    if (visWidth(t) > iw) break;
    s = t;
  }
  return s;
}

function authRow(a, iw) {
  const A = a.auth;
  const now = Date.now();
  if (!A.loggedIn) return red('✗ not logged in');
  const parts = [];

  if (a.provider === 'claude') {
    parts.push(A.stale ? yellow('! token stale') : green('✓ auth ok'));
    const lx = A.loginExpiresAt;
    if (lx) {
      parts.push(
        lx < now
          ? red(`login expired ${fmtD(lx)} — re-login`)
          : `login to ${fmtD(lx)} ${dim(`(in ${relDur(lx - now)})`)}`
      );
    }
    if (A.refreshed) parts.push(dim('auto-refreshed'));
    else if (!A.stale && A.accessExpiresAt && A.accessExpiresAt > now) {
      parts.push(dim(`token ~${fmtT(A.accessExpiresAt)}`));
    }
  } else {
    const ax = A.accessExpiresAt;
    if (A.stale) {
      parts.push(yellow(`! token expired ${fmtD(ax)} (${relDur(now - ax)} ago)`));
      parts.push(dim('renews on next run'));
    } else {
      parts.push(green('✓ auth ok'));
      if (ax) parts.push(`token to ${fmtD(ax)} ${dim(`(in ${relDur(ax - now)})`)}`);
    }
    if (A.lastRefreshAt) parts.push(dim(`refreshed ${relDur(now - A.lastRefreshAt)} ago`));
  }
  return fitParts(parts, iw);
}

function usageRow(w, iw, provider) {
  const now = Date.now();
  const label = padE(truncW(w.label, LBLW - 1), LBLW);
  const head = label + bar(w.pct, w.severity, w.ended) + ' ' + (w.ended ? dim(padS(`${Math.round(w.pct)}%`, 4)) : pctColor(w.pct, w.severity)(padS(`${Math.round(w.pct)}%`, 4)));

  let tails;
  if (w.ended) {
    tails = ['window ended — resets on use', 'window ended', 'ended'];
  } else if (w.resetsAt) {
    const rel = relDur(w.resetsAt - now);
    const abs = w.resetsAt - now < 86400000 ? fmtT(w.resetsAt) : fmtD(w.resetsAt);
    tails = [`resets ${rel} (${abs})`, `resets ${rel}`, rel, ''];
  } else if (provider === 'claude' && w.pct === 0) {
    // Live data with no reset time and nothing used: no window is running.
    tails = ['idle — starts on use', 'idle', ''];
  } else {
    tails = [''];
  }
  for (const t of tails) {
    const s = t ? head + dim('  ' + t) : head;
    if (visWidth(s) <= iw) return s;
  }
  return head;
}

function cardLines(a, cardW) {
  const iw = cardW - 4;
  const P = PROV[a.provider];
  const bd = (s) => dim(P.color(s));
  const rows = [];

  // email + plan
  const planPlain = a.plan || '—';
  const plan = a.plan ? P.color(bold(planPlain)) : dim(planPlain);
  const emailPlain = truncW(a.email || '(unknown account)', iw - visWidth(planPlain) - 1);
  rows.push(padE(a.email ? emailPlain : dim(emailPlain), iw - visWidth(planPlain)) + plan);

  rows.push(authRow(a, iw));
  rows.push('┈'.repeat(iw));

  if (a.error) {
    rows.push(red(truncW(a.error, iw)));
  } else if (a.usage?.windows?.length) {
    for (const w of a.usage.windows) rows.push(usageRow(w, iw, a.provider));
    if (a.usage.extra) {
      const x = a.usage.extra;
      rows.push(padE('Extra', LBLW) + dim(`$${x.used.toFixed(2)} / $${x.limit.toFixed(2)} ${x.currency}`));
    }
    if (a.provider === 'codex' && a.usage.asOf) {
      rows.push(dim(truncW(`last activity ${relDur(Date.now() - a.usage.asOf)} ago (${fmtDT(a.usage.asOf)})`, iw)));
    }
  } else if (a.provider === 'codex' && a.auth.loggedIn) {
    rows.push(dim('no usage data (no recent sessions)'));
  }
  for (const n of a.notes) rows.push(yellow(truncW(n, iw)));

  const title = ` ${P.color(bold(P.name))} ${dim('·')} ${bold(a.label)} `;
  const lines = [];
  lines.push(bd('╭─') + title + bd('─'.repeat(Math.max(0, cardW - 3 - visWidth(title))) + '╮'));
  for (const r of rows) {
    if (r === '┈'.repeat(iw)) lines.push(bd('│') + dim(' ' + r + ' ') + bd('│'));
    else lines.push(bd('│') + ' ' + padE(r, iw) + ' ' + bd('│'));
  }
  lines.push(bd('╰' + '─'.repeat(cardW - 2) + '╯'));
  return lines;
}

function alerts(results) {
  const out = [];
  const now = Date.now();
  for (const a of results) {
    const id = `${a.provider}/${a.label}`;
    if (a.error) out.push(red(`✗ ${id}: ${a.error}`));
    if (a.auth.stale) {
      out.push(
        a.provider === 'claude'
          ? yellow(`! ${id}: ${a.notes[0] || 'token stale'}`)
          : yellow(`! ${id}: token expired ${relDur(now - a.auth.accessExpiresAt)} ago — renews on next codex run`)
      );
    }
    if (a.provider === 'claude' && a.auth.loginExpiresAt) {
      const left = a.auth.loginExpiresAt - now;
      if (left < 0) out.push(red(`✗ ${id}: login expired — run claude auth login`));
      else if (left < 7 * 86400000) out.push(yellow(`! ${id}: re-login needed within ${relDur(left)}`));
    }
    for (const w of a.usage?.windows ?? []) {
      if (w.ended) continue;
      if (w.pct >= 90) out.push(red(`✗ ${id}: ${w.label} at ${Math.round(w.pct)}%`));
      else if (w.pct >= 70 || w.severity === 'warning') out.push(yellow(`! ${id}: ${w.label} at ${Math.round(w.pct)}%`));
    }
  }
  return out;
}

// Section rule spanning the grid, e.g. "── ◔ RESET SOON · 3 · weekly resets within 1d ─────".
// The subtitle is dropped when the grid is too narrow for it.
function bandHeader({ icon, name, sub, color }, count, width) {
  const text = (withSub) =>
    ' ' + (icon ? color(icon) + ' ' : '') + color(bold(name)) + ' ' +
    dim(`· ${count}${withSub && sub ? ` · ${sub}` : ''}`) + ' ';
  let t = text(true);
  if (visWidth(t) > width - 4) t = text(false);
  const rule = (n) => dim(color('─'.repeat(Math.max(0, n))));
  return rule(2) + t + rule(width - 2 - visWidth(t));
}

// Lay cards out left-to-right, `cols` per row; rows are padded to equal height.
function grid(cards, cols, cardW) {
  const out = [];
  for (let i = 0; i < cards.length; i += cols) {
    const row = cards.slice(i, i + cols);
    const h = Math.max(...row.map((c) => c.length));
    for (let l = 0; l < h; l++) {
      out.push(row.map((c) => c[l] ?? ' '.repeat(cardW)).join('  ').replace(/\s+$/, ''));
    }
  }
  return out;
}

export function render(results, { termW, oneCol, skipped, elapsedMs }) {
  const cols = oneCol || termW < 96 ? 1 : 2;
  let cardW = cols === 2 ? Math.min(Math.floor((termW - 2) / 2), 62) : Math.min(termW, 66);
  cardW = Math.max(cardW, 44);
  const width = cols * cardW + (cols - 1) * 2;

  const claude = results.filter((a) => a.provider === 'claude');
  const codex = results.filter((a) => a.provider === 'codex');
  const n = results.length;
  const count =
    claude.length && codex.length
      ? `${n} accounts ${dim(`(${claude.length} claude · ${codex.length} codex)`)}`
      : `${n} ${claude.length ? 'claude' : 'codex'} account${n === 1 ? '' : 's'}`;
  const out = [];
  out.push(bold('llmon') + dim(' · ') + count + dim(` · ${fmtDT(Date.now())} · ${(elapsedMs / 1000).toFixed(1)}s`));
  out.push('');

  const cards = (list) => grid(list.map((a) => cardLines(a, cardW)), cols, cardW);

  if (claude.length) {
    // Claude cards sit in lanes by weekly-window phase (see lanes.js). All three
    // lanes are always printed — an empty RESET SOON lane is information too.
    const laneId = (a) => (a.lane === undefined ? laneOf(a) : a.lane);
    const groups = LANES.map((L) => ({ ...L, color: LANE_COLOR[L.id], items: claude.filter((a) => laneId(a) === L.id) }));
    const nodata = claude.filter((a) => laneId(a) === null);
    if (nodata.length) groups.push({ ...NO_DATA, color: red, items: nodata });
    for (const g of groups) {
      out.push(bandHeader(g, g.items.length, width));
      if (g.items.length) out.push(...cards(g.items));
      out.push('');
    }
  }
  if (codex.length) {
    if (claude.length) out.push(bandHeader({ name: PROV.codex.name, color: PROV.codex.color }, codex.length, width));
    out.push(...cards(codex));
    out.push('');
  }

  const al = alerts(results);
  if (al.length) out.push(...al);
  else out.push(green('✓ all accounts healthy'));
  if (skipped.length) out.push(dim(`skipped: ${skipped.join(', ')}`));
  return out.join('\n');
}
