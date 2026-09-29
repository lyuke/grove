import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

// Keep the full scroll range while mounting only the viewport and a small buffer.
export default function VirtualList<T>({
  items,
  rowHeight,
  className,
  itemKey,
  render,
}: {
  items: T[];
  rowHeight: number;
  className: string;
  itemKey(item: T): string;
  render(item: T): ReactNode;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const virtual = items.length > 200;
  useLayoutEffect(() => {
    const element = host.current!;
    const update = () =>
      setViewport({ top: element.scrollTop, height: element.clientHeight });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    update();
    return () => observer.disconnect();
  }, []);
  const visibleCount = Math.ceil(viewport.height / rowHeight) + 16;
  const start = virtual
    ? Math.max(
        0,
        Math.min(
          Math.floor(viewport.top / rowHeight) - 8,
          items.length - visibleCount,
        ),
      )
    : 0;
  const end = virtual
    ? Math.min(items.length, start + visibleCount)
    : items.length;
  useLayoutEffect(() => {
    if (focusIndex === null) return;
    host.current
      ?.querySelector<HTMLElement>(
        `[data-virtual-index="${focusIndex}"] button`,
      )
      ?.focus({ preventScroll: true });
    setFocusIndex(null);
  }, [focusIndex, start, end]);
  return (
    <div
      ref={host}
      className={className}
      onScroll={(event) =>
        setViewport({
          top: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight,
        })
      }
      onKeyDown={(event) => {
        if (!virtual || !(event.target instanceof HTMLButtonElement)) return;
        const row = event.target.closest<HTMLElement>("[data-virtual-index]");
        if (
          !row ||
          !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
        )
          return;
        event.preventDefault();
        const index = Number(row.dataset.virtualIndex);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : Math.max(
                  0,
                  Math.min(
                    items.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
        const element = host.current!;
        if (next * rowHeight < element.scrollTop)
          element.scrollTop = next * rowHeight;
        else if (
          (next + 1) * rowHeight >
          element.scrollTop + element.clientHeight
        )
          element.scrollTop = (next + 1) * rowHeight - element.clientHeight;
        setViewport({ top: element.scrollTop, height: element.clientHeight });
        setFocusIndex(next);
      }}
    >
      <div style={{ height: start * rowHeight }} aria-hidden="true" />
      {items.slice(start, end).map((item, offset) => (
        <div
          key={itemKey(item)}
          data-virtual-index={start + offset}
          style={{ height: rowHeight }}
        >
          {render(item)}
        </div>
      ))}
      <div
        style={{ height: (items.length - end) * rowHeight }}
        aria-hidden="true"
      />
    </div>
  );
}
