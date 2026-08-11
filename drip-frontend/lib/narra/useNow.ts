"use client";

import { useEffect, useState } from "react";

/** Shared 1s clock for live age labels — avoids DOM hacks and stale server offsets. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
