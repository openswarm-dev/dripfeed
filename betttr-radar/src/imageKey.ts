/** Normalize pump/IPFS/Arweave media URLs to a fetchable https form. */
export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  let u = url.trim();
  if (u.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${u.slice(7)}`;
  if (u.startsWith('ar://')) return `https://arweave.net/${u.slice(5)}`;
  return u;
}

/**
 * Canonical key for image clustering — same asset across gateways, query params, and titles.
 * e.g. ipfs.io/ipfs/Qm… and cloudflare-ipfs.com/ipfs/Qm… → `ipfs:qm…`
 */
export function imageClusterKey(url?: string): string | null {
  const normalized = normalizeMediaUrl(url);
  if (!normalized) return null;

  const ipfsMatch = normalized.match(/\/ipfs\/([^/?#]+)/i);
  if (ipfsMatch?.[1]) return `ipfs:${ipfsMatch[1].toLowerCase()}`;

  const arMatch = normalized.match(/arweave\.net\/([^/?#]+)/i);
  if (arMatch?.[1]) return `ar:${arMatch[1].toLowerCase()}`;

  try {
    const parsed = new URL(normalized);
    return `url:${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    const bare = normalized.split('?')[0]?.toLowerCase();
    return bare ? `raw:${bare}` : null;
  }
}
