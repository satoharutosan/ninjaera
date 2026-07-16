import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/**
 * Cinematic hero atmosphere: parallax bg, rising smoke, fireflies, falling petals.
 * Mouse tracking uses refs + rAF (no React state on mousemove).
 */

const STYLE = `
.ne-hero-fx {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  z-index: 1;
}
.ne-hero-fx__bg {
  position: absolute;
  inset: -4% -6%;
  width: 112%;
  height: 108%;
  will-change: transform;
  transform: translate3d(0, 0, 0);
}
.ne-hero-fx__bg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.ne-hero-fx__veil {
  position: absolute;
  inset: 0;
  z-index: 2;
}
.ne-hero-fx__smoke {
  position: absolute;
  inset: 0;
  z-index: 3;
  overflow: hidden;
}
.ne-hero-fx__smoke-plume {
  position: absolute;
  bottom: -18%;
  width: 42%;
  height: 78%;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(220, 210, 230, 0.22) 0%, rgba(180, 170, 200, 0.08) 42%, transparent 72%);
  filter: blur(28px);
  opacity: 0.55;
  animation: neHeroSmokeRise linear infinite;
  will-change: transform, opacity;
}
.ne-hero-fx__fireflies {
  position: absolute;
  inset: 0;
  z-index: 4;
}
.ne-hero-fx__firefly {
  position: absolute;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 236, 170, 0.95) 0%, rgba(255, 200, 80, 0.45) 45%, transparent 70%);
  box-shadow: 0 0 6px 2px rgba(255, 210, 100, 0.35);
  animation: neHeroFireflyDrift ease-in-out infinite;
  will-change: transform, opacity;
}
.ne-hero-fx__petals {
  position: absolute;
  inset: 0;
  z-index: 4;
  overflow: hidden;
}
.ne-hero-fx__petal {
  position: absolute;
  width: 10px;
  height: 14px;
  border-radius: 60% 40% 60% 40%;
  background: linear-gradient(145deg, rgba(180, 60, 110, 0.75), rgba(120, 30, 70, 0.55));
  box-shadow: 0 0 8px rgba(160, 40, 90, 0.25);
  animation: neHeroPetalFall linear infinite;
  will-change: transform, opacity;
  opacity: 0;
}
@keyframes neHeroSmokeRise {
  0%   { transform: translate3d(0, 12%, 0) scale(0.85); opacity: 0; }
  18%  { opacity: 0.5; }
  55%  { opacity: 0.35; }
  100% { transform: translate3d(4%, -55%, 0) scale(1.35); opacity: 0; }
}
@keyframes neHeroFireflyDrift {
  0%   { transform: translate3d(0, 0, 0) scale(0.4); opacity: 0; }
  15%  { opacity: 0.85; }
  50%  { transform: translate3d(var(--fx), calc(var(--fy) * -1), 0) scale(1); opacity: 0.7; }
  85%  { opacity: 0.45; }
  100% { transform: translate3d(calc(var(--fx) * 1.4), calc(var(--fy) * -1.6), 0) scale(0.5); opacity: 0; }
}
@keyframes neHeroPetalFall {
  0%   { transform: translate3d(0, -8%, 0) rotate(0deg); opacity: 0; }
  8%   { opacity: 0.75; }
  70%  { opacity: 0.55; }
  100% { transform: translate3d(var(--px), 110vh, 0) rotate(var(--pr)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ne-hero-fx__smoke-plume,
  .ne-hero-fx__firefly,
  .ne-hero-fx__petal {
    animation: none !important;
    opacity: 0 !important;
  }
  .ne-hero-fx__bg {
    transform: none !important;
  }
}
`;

type Props = {
  src: string;
  alt: string;
};

type CssVars = CSSProperties & Record<`--${string}`, string>;

const SMOKE = [
  { left: "-6%", delay: "0s", duration: "18s" },
  { left: "28%", delay: "5s", duration: "22s" },
  { left: "58%", delay: "10s", duration: "20s" },
];

const FIREFLIES = [
  { top: "22%", left: "18%", delay: "0s", duration: "9s", fx: "28px", fy: "36px" },
  { top: "38%", left: "62%", delay: "2.2s", duration: "11s", fx: "-34px", fy: "28px" },
  { top: "58%", left: "34%", delay: "4.5s", duration: "10s", fx: "22px", fy: "42px" },
  { top: "28%", left: "78%", delay: "1.1s", duration: "12s", fx: "-18px", fy: "30px" },
  { top: "68%", left: "12%", delay: "6s", duration: "9.5s", fx: "40px", fy: "24px" },
  { top: "48%", left: "88%", delay: "3.4s", duration: "10.5s", fx: "-26px", fy: "38px" },
  { top: "16%", left: "48%", delay: "7.2s", duration: "11.5s", fx: "16px", fy: "44px" },
  { top: "72%", left: "55%", delay: "5.1s", duration: "8.5s", fx: "-30px", fy: "20px" },
];

const PETALS = [
  { left: "72%", delay: "0s", duration: "14s", px: "-40px", pr: "220deg" },
  { left: "80%", delay: "3s", duration: "16s", px: "28px", pr: "-180deg" },
  { left: "88%", delay: "6.5s", duration: "13s", px: "-18px", pr: "260deg" },
  { left: "76%", delay: "9s", duration: "15s", px: "36px", pr: "-200deg" },
  { left: "92%", delay: "1.8s", duration: "17s", px: "-50px", pr: "160deg" },
  { left: "84%", delay: "11s", duration: "14.5s", px: "22px", pr: "-240deg" },
];

export function HeroAmbientBackground({ src, alt }: Props) {
  const bgRef = useRef<HTMLDivElement>(null);
  const targetX = useRef(0);
  const currentX = useRef(0);
  const rafId = useRef(0);
  const skipParallax = useRef(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const coarseMq = window.matchMedia("(pointer: coarse), (max-width: 768px)");
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setCompact(coarseMq.matches);
      skipParallax.current = coarseMq.matches || reduceMq.matches;
      if (skipParallax.current) {
        targetX.current = 0;
        currentX.current = 0;
        if (bgRef.current) bgRef.current.style.transform = "translate3d(0,0,0)";
      }
    };
    sync();
    coarseMq.addEventListener("change", sync);
    reduceMq.addEventListener("change", sync);
    return () => {
      coarseMq.removeEventListener("change", sync);
      reduceMq.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const el = bgRef.current;
    if (!el) return;

    let running = true;
    const tick = () => {
      if (!running) return;
      currentX.current += (targetX.current - currentX.current) * 0.06;
      if (Math.abs(targetX.current - currentX.current) > 0.05 || Math.abs(currentX.current) > 0.05) {
        el.style.transform = `translate3d(${currentX.current.toFixed(2)}px, 0, 0)`;
      }
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);

    const onMove = (e: MouseEvent) => {
      if (skipParallax.current) return;
      const w = window.innerWidth || 1;
      const norm = (e.clientX / w) * 2 - 1;
      targetX.current = norm * -28;
    };
    const onLeave = () => { targetX.current = 0; };

    window.addEventListener("mousemove", onMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", onLeave);

    return () => {
      running = false;
      cancelAnimationFrame(rafId.current);
      window.removeEventListener("mousemove", onMove);
      document.documentElement.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  const fireflies = useMemo(() => (compact ? FIREFLIES.slice(0, 4) : FIREFLIES), [compact]);
  const petals = useMemo(() => (compact ? PETALS.slice(0, 3) : PETALS), [compact]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="ne-hero-fx" aria-hidden>
        <div className="ne-hero-fx__bg" ref={bgRef}>
          <img src={src} alt={alt} loading="eager" fetchPriority="high" decoding="async" />
        </div>
        <div
          className="ne-hero-fx__veil"
          style={{ background: "linear-gradient(to right,rgba(0,0,0,.78),rgba(0,0,0,.45) 60%,rgba(0,0,0,.15))" }}
        />
        <div
          className="ne-hero-fx__veil"
          style={{ background: "linear-gradient(to top,rgba(0,0,0,.5),transparent 40%)" }}
        />
        <div className="ne-hero-fx__smoke">
          {SMOKE.map((s, i) => (
            <div
              key={i}
              className="ne-hero-fx__smoke-plume"
              style={{
                left: s.left,
                animationDelay: s.delay,
                animationDuration: s.duration,
              }}
            />
          ))}
        </div>
        <div className="ne-hero-fx__fireflies">
          {fireflies.map((f, i) => (
            <span
              key={i}
              className="ne-hero-fx__firefly"
              style={{
                top: f.top,
                left: f.left,
                animationDelay: f.delay,
                animationDuration: f.duration,
                "--fx": f.fx,
                "--fy": f.fy,
              } as CssVars}
            />
          ))}
        </div>
        <div className="ne-hero-fx__petals">
          {petals.map((p, i) => (
            <span
              key={i}
              className="ne-hero-fx__petal"
              style={{
                left: p.left,
                top: "-4%",
                animationDelay: p.delay,
                animationDuration: p.duration,
                "--px": p.px,
                "--pr": p.pr,
              } as CssVars}
            />
          ))}
        </div>
      </div>
    </>
  );
}
