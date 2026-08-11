/** Normalize pump/IPFS/Arweave media URLs to a fetchable https form. */
const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs/',
  'https://ipfs.io/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://w3s.link/ipfs/',
];

export function ipfsCidFromUrl(url?: string): string | null {
  if (!url) return null;
  const u = url.trim();
  if (u.startsWith('ipfs://')) return u.slice(7).replace(/^ipfs\//, '');
  const m = u.match(/\/ipfs\/([^/?#]+)/i);
  return m?.[1] ?? null;
}

export function ipfsGatewayUrls(url?: string): string[] {
  const cid = ipfsCidFromUrl(url);
  if (!cid) {
    const n = normalizeMediaUrl(url);
    return n ? [n] : [];
  }
  return IPFS_GATEWAYS.map((g) => `${g}${cid}`);
}

export function normalizeMediaUrl(url?: string): string | undefined {
  if (!url) return undefined;
  let u = url.trim();
  if (u.startsWith('ipfs://')) {
    return `${IPFS_GATEWAYS[0]}${u.slice(7).replace(/^ipfs\//, '')}`;
  }
  if (u.startsWith('ar://')) return `https://arweave.net/${u.slice(5)}`;

  // Prefer working public gateways over dead cf-ipfs.com
  u = u.replace('https://cf-ipfs.com/ipfs/', IPFS_GATEWAYS[0]!);
  u = u.replace('https://cloudflare-ipfs.com/ipfs/', IPFS_GATEWAYS[0]!);
  u = u.replace('https://gateway.pinata.cloud/ipfs/', IPFS_GATEWAYS[0]!);
  u = u.replace('https://ipfs.io/ipfs/', IPFS_GATEWAYS[0]!);
  u = u.replace('http://ipfs.io/ipfs/', IPFS_GATEWAYS[0]!);

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
