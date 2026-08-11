"use client";

import { fmtAge } from "@/lib/narra/format";
import { useNow } from "@/lib/narra/useNow";

export function LiveAge({
  ts,
  suffix = "",
  className,
}: {
  ts?: number | null;
  suffix?: string;
  className?: string;
}) {
  const now = useNow();
  if (!ts) return <span className={className}>—</span>;
  return (
    <span className={className}>
      {fmtAge(Math.max(0, now - ts))}
      {suffix}
    </span>
  );
}
