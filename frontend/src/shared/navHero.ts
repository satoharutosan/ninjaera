import { useEffect, useState } from "react";

/** Mark page heroes with this attribute so the shared navbar adapts automatically. */
export const NAV_HERO_ATTR = "data-nav-hero";
export const NAV_HERO_SELECTOR = `[${NAV_HERO_ATTR}]`;
export const NAV_BAR_HEIGHT_PX = 64;

/**
 * True while any `[data-nav-hero]` section intersects the area under the fixed navbar.
 * Centralized for all routes — pages only need the marker; no per-page allowlists.
 */
export function useNavHeroOverlay(routeKey: string) {
  const [overHero, setOverHero] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let io: IntersectionObserver | null = null;
    let lastHeroCount = -1;
    let rafId = 0;

    const disconnectIo = () => {
      io?.disconnect();
      io = null;
    };

    const observe = () => {
      if (cancelled) return;
      disconnectIo();
      const heroes = document.querySelectorAll(NAV_HERO_SELECTOR);
      lastHeroCount = heroes.length;
      if (!heroes.length) {
        setOverHero(false);
        return;
      }

      // Instant sync before the observer's first callback (avoids a solid flash).
      const anyVisible = Array.from(heroes).some((el) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.bottom > NAV_BAR_HEIGHT_PX && r.top < window.innerHeight;
      });
      setOverHero(anyVisible);

      io = new IntersectionObserver(
        (entries) => {
          if (cancelled) return;
          setOverHero(entries.some((e) => e.isIntersecting));
        },
        {
          root: null,
          rootMargin: `-${NAV_BAR_HEIGHT_PX}px 0px 0px 0px`,
          threshold: 0,
        },
      );
      heroes.forEach((el) => io!.observe(el));
    };

    const scheduleObserve = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(observe);
    };

    scheduleObserve();

    // Pick up heroes mounted after route paint (no page-name allowlists).
    const mo = new MutationObserver(() => {
      const count = document.querySelectorAll(NAV_HERO_SELECTOR).length;
      if (count !== lastHeroCount) scheduleObserve();
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [NAV_HERO_ATTR],
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      disconnectIo();
      mo.disconnect();
    };
  }, [routeKey]);

  return overHero;
}
