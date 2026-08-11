import type { LaunchRecord } from "./types";

/** True when a string is just a mint address fragment, not a real ticker/name. */
export function isMintLikeLabel(value: string | undefined, mint: string): boolean {
  if (!value) return true;
  const t = value.trim();
  if (t.length < 4) return true;
  if (t === mint || mint.startsWith(t) || t === mint.slice(0, 8)) return true;
  if (t.length >= 8 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(t) && !/\s/.test(t)) return true;
  return false;
}

export function getLaunchDisplay(l: LaunchRecord): {
  label: string;
  sub: string | null;
  pending: boolean;
} {
  const sym = l.symbol?.trim();
  const name = l.name?.trim();
  const symOk = sym && !isMintLikeLabel(sym, l.mint);
  const nameOk = name && !isMintLikeLabel(name, l.mint);

  if (symOk) {
    return {
      label: sym,
      sub: nameOk && name!.toLowerCase() !== sym.toLowerCase() ? name! : null,
      pending: false,
    };
  }
  if (nameOk) {
    return { label: name!, sub: null, pending: false };
  }
  return { label: "New token", sub: "Loading name & image…", pending: true };
}

/** Hide stale rows that never resolved to a real token name. */
export function shouldShowLaunch(l: LaunchRecord, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const { pending } = getLaunchDisplay(l);
  if (!pending) return true;
  if (!l.blockTime) return true;
  return nowSec - l.blockTime < 120;
}
