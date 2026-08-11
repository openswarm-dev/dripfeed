"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export interface FeedItem {
  id: string;
  isNew?: boolean;
}

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

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const nextPos = new Map<string, DOMRect>();
    for (const node of list.children) {
      const el = node as HTMLElement;
      const id = el.dataset.feedId;
      if (!id) continue;

      const rect = el.getBoundingClientRect();
      nextPos.set(id, rect);

      const prev = posRef.current.get(id);
      if (prev) {
        const dy = prev.top - rect.top;
        if (Math.abs(dy) > 2) {
          el.style.transform = `translateY(${dy}px)`;
          el.style.transition = "transform 0s";
          requestAnimationFrame(() => {
            el.style.transition = "transform 0.55s cubic-bezier(0.22, 1, 0.36, 1)";
            el.style.transform = "";
          });
        }
      }
    }
    posRef.current = nextPos;
  }, [items]);

  return (
    <div ref={listRef} className={className}>
      {items.map((item) => (
        <div
          key={item.id}
          data-feed-id={item.id}
          className={`feed-item ${item.isNew ? "feed-item--enter" : ""}`}
        >
          {renderItem(item)}
        </div>
      ))}
    </div>
  );
}
