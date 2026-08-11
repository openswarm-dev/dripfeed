"use client";

import { useMemo, useState } from "react";

const IPFS_GATEWAYS = [
  "https://dweb.link/ipfs/",
  "https://ipfs.io/ipfs/",
  "https://nftstorage.link/ipfs/",
  "https://w3s.link/ipfs/",
];

function cidFromSrc(src?: string): string | null {
  if (!src) return null;
  if (src.startsWith("ipfs://")) return src.slice(7).replace(/^ipfs\//, "");
  const m = src.match(/\/ipfs\/([^/?#]+)/i);
  return m?.[1] ?? null;
}

function candidatesFor(src?: string): string[] {
  if (!src) return [];
  const cid = cidFromSrc(src);
  if (!cid) return [src];
  return [...new Set(IPFS_GATEWAYS.map((g) => `${g}${cid}`))];
}

export function TokenImage({
  src,
  size = 30,
  className = "",
  priority = false,
}: {
  src?: string;
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  const candidates = useMemo(() => candidatesFor(src), [src]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = !failed ? candidates[idx] : undefined;

  if (!current) {
    return (
      <div
        className={`token-img token-img--placeholder ${className}`}
        style={{ width: size, height: size }}
        aria-hidden
      >
        ?
      </div>
    );
  }

  return (
    <div
      className={`token-img-wrap ${className}`}
      style={{ width: size, height: size }}
    >
      {!loaded && <div className="token-img-spinner" aria-label="Loading" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={current}
        src={current}
        alt=""
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority ? "high" : "auto"}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setLoaded(false);
          if (idx + 1 < candidates.length) setIdx(idx + 1);
          else setFailed(true);
        }}
        className={loaded ? "is-loaded" : ""}
      />
    </div>
  );
}
