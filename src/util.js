export const state = { color: true };

const wrap = (open, close) => (s) =>
  state.color ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);

export const bold = wrap(1, 22);
export const dim = wrap(2, 22);
export const red = wrap(31, 39);
export const green = wrap(32, 39);
export const yellow = wrap(33, 39);
export const fg = (n) => wrap(`38;5;${n}`, 39);

const ANSI_RE = /\x1b\[[0-9;]*m/g;
export const stripAnsi = (s) => s.replace(ANSI_RE, '');

function charW(cp) {
  if (cp === 0x200b || (cp >= 0x300 && cp <= 0x36f)) return 0;
  if (
    cp >= 0x1100 &&
    (cp <= 0x115f ||
      cp === 0x2329 ||
      cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe6b) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      (cp >= 0x20000 && cp <= 0x3fffd))
  )
    return 2;
  return 1;
}

export function visWidth(s) {
  let w = 0;
  for (const ch of stripAnsi(s)) w += charW(ch.codePointAt(0));
  return w;
}

export const padE = (s, w) => s + ' '.repeat(Math.max(0, w - visWidth(s)));
export const padS = (s, w) => ' '.repeat(Math.max(0, w - visWidth(s))) + s;

// Truncate a PLAIN (uncolored) string to a visual width; color afterwards.
export function truncW(s, w) {
  if (visWidth(s) <= w) return s;
  let out = '';
  let cw = 0;
  for (const ch of stripAnsi(s)) {
    const c = charW(ch.codePointAt(0));
    if (cw + c > w - 1) break;
    out += ch;
    cw += c;
  }
  return out + '…';
}

export function relDur(ms) {
  const m = Math.round(Math.abs(ms) / 60000);
  if (m < 1) return '<1m';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? ` ${h % 24}h` : ''}`;
}

const p2 = (n) => String(n).padStart(2, '0');
export const fmtDT = (ts) => {
  const d = new Date(ts);
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
export const fmtD = (ts) => {
  const d = new Date(ts);
  return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}`;
};
export const fmtT = (ts) => {
  const d = new Date(ts);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
};
