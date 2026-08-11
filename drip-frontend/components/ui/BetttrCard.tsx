"use client";

import type { ReactNode } from "react";

type Accent = "spark" | "forming" | "active" | "launch" | "detail" | "timeline" | "hero";

export function BetttrCard({
  children,
  className = "",
  accent,
}: {
  children: ReactNode;
  className?: string;
  accent?: Accent;
}) {
  return (
    <section className={`betttr-card ${accent ? `betttr-card--${accent}` : ""} ${className}`}>
      <div className="betttr-card__edge rainbow-bg" aria-hidden="true" />
      <div className="betttr-card__body">{children}</div>
    </section>
  );
}

export function PanelTitle({ children, count, variant = "default" }: {
  children: ReactNode;
  count?: number | string;
  variant?: "default" | "warn" | "live";
}) {
  return (
    <div className="betttr-panel-head">
      <h2 className="t-label betttr-panel-title">{children}</h2>
      {count != null && (
        <span className={`betttr-badge betttr-badge--${variant}`}>{count}</span>
      )}
    </div>
  );
}
