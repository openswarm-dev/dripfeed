"use client";

const PUMP_LOGO = "/logos/pumpfun.png";

export function PumpFunButton({
  mint,
  size = 26,
  className = "",
}: {
  mint: string;
  size?: number;
  className?: string;
}) {
  return (
    <a
      href={`https://pump.fun/coin/${mint}`}
      target="_blank"
      rel="noopener noreferrer"
      className={`pump-fun-btn ${className}`}
      title="Open on pump.fun"
      onClick={(e) => e.stopPropagation()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PUMP_LOGO}
        alt="pump.fun"
        width={size}
        height={size}
        draggable={false}
      />
    </a>
  );
}
