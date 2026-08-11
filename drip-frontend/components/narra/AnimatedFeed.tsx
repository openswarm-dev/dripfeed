"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface FeedItem {
  id: string;
}

/**
 * Feed list with restrained motion:
 * - Enter animation only for IDs that appear after the first paint
 * - FLIP reorder only when the ID order actually changes
 * - Content updates (metrics/images) never slide cards around
 */
export function AnimatedFeed<T extends FeedItem>({
  items,
  className = "",
  renderItem,
}: {
  items: T[];
  className?: string;
  renderItem: (item: T) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Map<string, DOMRect>>(new Map());
  const orderRef = useRef<string>("");
  const seenRef = useRef<Set<string>>(new Set());
  const bootedRef = useRef(false);
  const [entering, setEntering] = useState<Set<string>>(() => new Set());

  const orderKey = items.map((i) => i.id).join("\0");

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    // First paint: seed seen IDs, capture positions, no animation.
    if (!bootedRef.current) {
      bootedRef.current = true;
      for (const item of items) seenRef.current.add(item.id);
      orderRef.current = orderKey;
      const initial = new Map<string, DOMRect>();
      for (const node of list.children) {
        const el = node as HTMLElement;
        const id = el.dataset.feedId;
        if (id) initial.set(id, el.getBoundingClientRect());
      }
      posRef.current = initial;
      return;
    }

    const orderChanged = orderKey !== orderRef.current;
    orderRef.current = orderKey;

    const fresh = new Set<string>();
    for (const item of items) {
      if (!seenRef.current.has(item.id)) {
        seenRef.current.add(item.id);
        fresh.add(item.id);
      }
    }

    if (fresh.size) {
      setEntering((prev) => {
        const next = new Set(prev);
        for (const id of fresh) next.add(id);
        return next;
      });
      window.setTimeout(() => {
        setEntering((prev) => {
          if (![...fresh].some((id) => prev.has(id))) return prev;
          const next = new Set(prev);
          for (const id of fresh) next.delete(id);
          return next;
        });
      }, 350);
    }

    const nextPos = new Map<string, DOMRect>();
    for (const node of list.children) {
      const el = node as HTMLElement;
      const id = el.dataset.feedId;
      if (!id) continue;

      const rect = el.getBoundingClientRect();
      nextPos.set(id, rect);

      // Only FLIP when rank order changed — ignore height/content shifts.
      if (!orderChanged || fresh.has(id)) continue;

      const prev = posRef.current.get(id);
      if (!prev) continue;
      const dy = prev.top - rect.top;
      if (Math.abs(dy) < 4) continue;

      el.style.transition = "none";
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetHeight;
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)";
        el.style.transform = "";
        const done = () => {
          el.style.transition = "";
          el.removeEventListener("transitionend", done);
        };
        el.addEventListener("transitionend", done);
      });
    }

    posRef.current = nextPos;
  }, [orderKey, items]);

  return (
    <div ref={listRef} className={className}>
      {items.map((item) => (
        <div
          key={item.id}
          data-feed-id={item.id}
          className={`feed-item${entering.has(item.id) ? " feed-item--enter" : ""}`}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
