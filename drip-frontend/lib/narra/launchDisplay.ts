import type { LaunchRecord } from "./types";

/** True when a string is just a mint address fragment, not a real ticker/name. */
export function isMintLikeLabel(value: string | undefined, mint: string): boolean {
  if (!value) return true;
  const t = value.trim();
  if (t.length < 1) return true;
  if (t === mint || t === mint.slice(0, 8)) return true;
  // Long base58 blobs look like addresses, not tickers.
  if (t.length >= 20 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(t) && !/\s/.test(t)) return true;
  return false;
}

export function getLaunchDisplay(l: LaunchRecord): {
  label: string;
  sub: string | null;
  pending: boolean;
} {
  const sym = l.symbol?.trim();
  const name = l.name?.trim();
  const symOk = !!sym && !isMintLikeLabel(sym, l.mint);
  const nameOk = !!name && !isMintLikeLabel(name, l.mint);

  if (symOk) {
    return {
      label: sym!,
      sub: nameOk && name!.toLowerCase() !== sym!.toLowerCase() ? name! : null,
      pending: false,
    };
  }
  if (nameOk) {
    return { label: name!, sub: null, pending: false };
  }
  // Never show "New token / Loading…" — use whatever string we have, or a quiet ellipsis.
  if (sym) return { label: sym, sub: null, pending: true };
  if (name) return { label: name, sub: null, pending: true };
  return { label: "…", sub: null, pending: true };
}

/** Hide stale rows that never resolved to a real token name. */
export function shouldShowLaunch(l: LaunchRecord, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const { pending } = getLaunchDisplay(l);
  if (!pending) return true;
  if (!l.blockTime) return true;
  // Keep unresolved creates visible for 3 minutes while metadata loads.
  return nowSec - l.blockTime < 180;
}
