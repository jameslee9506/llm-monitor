import { readdirSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Accounts live in per-account config homes:
//   claude: ~/.claude-<label> (config at <dir>/.claude.json), default: ~/.claude + ~/.claude.json
//   codex:  ~/.codex-<label>  (auth at <dir>/auth.json),      default: ~/.codex
export function discover() {
  const home = homedir();
  const accounts = [];
  const skipped = [];

  let names = [];
  try {
    names = readdirSync(home);
  } catch {
    return { accounts, skipped };
  }
  const isDir = (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };

  if (existsSync(join(home, '.claude.json')) && isDir(join(home, '.claude'))) {
    accounts.push({
      provider: 'claude',
      label: 'default',
      dir: join(home, '.claude'),
      cfgPath: join(home, '.claude.json'),
      service: 'Claude Code-credentials',
    });
  }
  for (const n of names.filter((n) => n.startsWith('.claude-')).sort()) {
    const dir = join(home, n);
    if (!isDir(dir)) continue;
    const cfgPath = join(dir, '.claude.json');
    if (existsSync(cfgPath)) {
      accounts.push({ provider: 'claude', label: n.slice('.claude-'.length), dir, cfgPath, service: null });
    } else {
      skipped.push(`~/${n} (no .claude.json — not an account dir)`);
    }
  }

  if (existsSync(join(home, '.codex', 'auth.json'))) {
    accounts.push({ provider: 'codex', label: 'default', dir: join(home, '.codex') });
  }
  for (const n of names.filter((n) => n.startsWith('.codex-')).sort()) {
    const dir = join(home, n);
    if (!isDir(dir)) continue;
    if (existsSync(join(dir, 'auth.json'))) {
      accounts.push({ provider: 'codex', label: n.slice('.codex-'.length), dir });
    } else {
      skipped.push(`~/${n} (no auth.json — not an account dir)`);
    }
  }

  return { accounts, skipped };
}
