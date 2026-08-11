"use client";

import { useState } from "react";

export function TokenImage({
  src,
  size = 30,
  className = "",
}: {
  src?: string;
  size?: number;
  className?: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (!src || error) {
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
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={loaded ? "is-loaded" : ""}
      />
    </div>
  );
}
