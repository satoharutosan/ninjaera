import { useCallback, useRef } from "react";

/** Briefly toggles `is-scrolling` on a scroll container for CSS scrollbar reveals. */
export function useScrollReveal() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.classList.add("is-scrolling");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove("is-scrolling"), 900);
  }, []);
}
