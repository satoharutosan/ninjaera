import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Defers mounting heavy children until near the viewport.
 * Keeps `minHeight` after reveal so deferred media cannot collapse then expand
 * (which would shift Virtuoso scroll position).
 */
export function LazyVisible({
  children,
  placeholderHeight = 120,
  rootMargin = "240px",
}: {
  children: ReactNode;
  placeholderHeight?: number;
  rootMargin?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible, rootMargin]);

  return (
    <div ref={ref} style={{ minHeight: placeholderHeight }}>
      {visible ? (
        children
      ) : (
        <div
          className="rounded-2xl animate-pulse"
          style={{
            height: placeholderHeight,
            width: "min(280px, 100%)",
            background: "rgba(0,0,0,.06)",
          }}
        />
      )}
    </div>
  );
}
