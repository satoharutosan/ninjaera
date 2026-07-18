import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

/**
 * Cinematic hero atmosphere: looping character video (or poster), parallax,
 * fine rising smoke (right), fireflies.
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
.ne-hero-fx__bg img,
.ne-hero-fx__bg video,
.ne-hero-fx__bg-video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  display: block;
}
.ne-hero-fx__bg-video {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ne-hero-fx__poster {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center center;
  transition: opacity 280ms ease;
  z-index: 1;
}
.ne-hero-fx__poster--hidden {
  opacity: 0;
  pointer-events: none;
}
.ne-hero-fx__veil {
  position: absolute;
  inset: 0;
  z-index: 2;
}
.ne-hero-fx__smoke {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 48%;
  z-index: 3;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to right, transparent 0%, black 28%, black 100%);
  mask-image: linear-gradient(to right, transparent 0%, black 28%, black 100%);
}
.ne-hero-fx__smoke-plume {
  position: absolute;
  bottom: -22%;
  border-radius: 55% 45% 60% 40%;
  background:
    radial-gradient(ellipse 70% 55% at 50% 60%,
      rgba(210, 205, 220, 0.28) 0%,
      rgba(170, 165, 185, 0.1) 38%,
      transparent 70%);
  filter: blur(22px);
  opacity: 0;
  animation: neHeroSmokeRise ease-in-out infinite;
  will-change: transform, opacity;
  transform: translate3d(0, 0, 0);
  mix-blend-mode: screen;
}
.ne-hero-fx__smoke-plume--soft {
  filter: blur(34px);
  mix-blend-mode: soft-light;
  background:
    radial-gradient(ellipse 80% 60% at 45% 55%,
      rgba(200, 198, 210, 0.2) 0%,
      rgba(160, 158, 175, 0.07) 45%,
      transparent 72%);
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
@keyframes neHeroSmokeRise {
  0% {
    transform: translate3d(0, 8%, 0) scale(0.72) rotate(0deg);
    opacity: 0;
  }
  12% {
    opacity: var(--smoke-peak, 0.42);
  }
  45% {
    transform: translate3d(var(--smoke-mid-x, 3%), -28%, 0) scale(1.05) rotate(var(--smoke-rot, 4deg));
    opacity: calc(var(--smoke-peak, 0.42) * 0.72);
  }
  75% {
    opacity: calc(var(--smoke-peak, 0.42) * 0.28);
  }
  100% {
    transform: translate3d(var(--smoke-end-x, -2%), -72%, 0) scale(1.45) rotate(var(--smoke-rot-end, -3deg));
    opacity: 0;
  }
}
@keyframes neHeroFireflyDrift {
  0%   { transform: translate3d(0, 0, 0) scale(0.4); opacity: 0; }
  15%  { opacity: 0.85; }
  50%  { transform: translate3d(var(--fx), calc(var(--fy) * -1), 0) scale(1); opacity: 0.7; }
  85%  { opacity: 0.45; }
  100% { transform: translate3d(calc(var(--fx) * 1.4), calc(var(--fy) * -1.6), 0) scale(0.5); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ne-hero-fx__smoke-plume,
  .ne-hero-fx__firefly {
    animation: none !important;
    opacity: 0 !important;
  }
  .ne-hero-fx__bg {
    transform: none !important;
  }
}
@media (max-width: 768px) {
  .ne-hero-fx__smoke {
    left: 40%;
  }
  .ne-hero-fx__smoke-plume {
    filter: blur(18px);
  }
  .ne-hero-fx__smoke-plume--soft {
    filter: blur(26px);
  }
}
`;

type Props = {
  /** Static poster / fallback image (original hero artwork). */
  src: string;
  alt: string;
  /** Preferred WebM (VP9/AV1) source for the looping character video. */
  videoWebm?: string;
  /** H.264 MP4 fallback for broader browser support. */
  videoMp4?: string;
};

type CssVars = CSSProperties & Record<`--${string}`, string>;

type SmokePlume = {
  left: string;
  width: string;
  height: string;
  delay: string;
  duration: string;
  peak: string;
  midX: string;
  endX: string;
  rot: string;
  rotEnd: string;
  soft?: boolean;
};

/** Right-side mist wisps — staggered for a continuous, organic rise. */
const SMOKE: SmokePlume[] = [
  { left: "8%",  width: "38%", height: "70%", delay: "0s",   duration: "16s", peak: "0.38", midX: "5%",  endX: "-3%",  rot: "5deg",  rotEnd: "-4deg" },
  { left: "28%", width: "32%", height: "62%", delay: "2.8s", duration: "19s", peak: "0.32", midX: "-4%", endX: "6%",   rot: "-3deg", rotEnd: "5deg", soft: true },
  { left: "48%", width: "42%", height: "78%", delay: "5.5s", duration: "17s", peak: "0.36", midX: "7%",  endX: "-5%",  rot: "6deg",  rotEnd: "-2deg" },
  { left: "18%", width: "28%", height: "55%", delay: "8s",   duration: "21s", peak: "0.28", midX: "-6%", endX: "4%",   rot: "-5deg", rotEnd: "3deg", soft: true },
  { left: "58%", width: "36%", height: "68%", delay: "1.4s", duration: "18s", peak: "0.34", midX: "3%",  endX: "-7%",  rot: "2deg",  rotEnd: "-6deg" },
  { left: "38%", width: "30%", height: "58%", delay: "11s",  duration: "20s", peak: "0.26", midX: "-3%", endX: "5%",   rot: "-4deg", rotEnd: "4deg", soft: true },
  { left: "68%", width: "34%", height: "72%", delay: "7s",   duration: "15s", peak: "0.3",  midX: "6%",  endX: "-2%",  rot: "4deg",  rotEnd: "-5deg" },
  { left: "12%", width: "44%", height: "64%", delay: "13.5s",duration: "22s", peak: "0.24", midX: "-5%", endX: "3%",   rot: "-2deg", rotEnd: "6deg", soft: true },
  { left: "52%", width: "26%", height: "50%", delay: "4s",   duration: "14s", peak: "0.33", midX: "4%",  endX: "-6%",  rot: "3deg",  rotEnd: "-3deg" },
  { left: "72%", width: "40%", height: "66%", delay: "9.5s", duration: "19s", peak: "0.27", midX: "-2%", endX: "4%",   rot: "-6deg", rotEnd: "2deg", soft: true },
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

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function HeroAmbientBackground({ src, alt, videoWebm, videoMp4 }: Props) {
  const bgRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetX = useRef(0);
  const currentX = useRef(0);
  const rafId = useRef(0);
  const skipParallax = useRef(false);
  const [compact, setCompact] = useState(false);
  const hasVideoSources = !!(videoWebm || videoMp4);
  /** False → show static poster only (no video / failed / reduced motion). */
  const [videoEnabled, setVideoEnabled] = useState(() => hasVideoSources && !prefersReducedMotion());
  /** True once the video has painted a frame (hide poster fade). */
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    const coarseMq = window.matchMedia("(pointer: coarse), (max-width: 768px)");
    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      setCompact(coarseMq.matches);
      skipParallax.current = coarseMq.matches || reduceMq.matches;
      if (reduceMq.matches) {
        setVideoEnabled(false);
        setVideoReady(false);
      } else if (hasVideoSources) {
        setVideoEnabled(true);
      }
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
  }, [hasVideoSources]);

  // Parallax — unchanged, applies to the whole bg layer (video + poster).
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

  // Autoplay + seamless loop + visibility pause/resume.
  useEffect(() => {
    if (!videoEnabled) return;
    const video = videoRef.current;
    const root = rootRef.current;
    if (!video) return;

    let cancelled = false;

    const tryPlay = () => {
      if (cancelled) return;
      const p = video.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          if (!cancelled) {
            setVideoEnabled(false);
            setVideoReady(false);
          }
        });
      }
    };

    const onCanPlay = () => tryPlay();
    const onPlaying = () => {
      if (!cancelled) setVideoReady(true);
    };
    const onError = () => {
      if (!cancelled) {
        setVideoEnabled(false);
        setVideoReady(false);
      }
    };
    // Fallback if `loop` fails to restart (rare engines).
    const onEnded = () => {
      video.currentTime = 0;
      tryPlay();
    };

    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("error", onError);
    video.addEventListener("ended", onEnded);

    if (video.readyState >= 2) tryPlay();

    let io: IntersectionObserver | null = null;
    if (root && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          const visible = entries.some((e) => e.isIntersecting);
          if (visible) tryPlay();
          else if (!video.paused) video.pause();
        },
        { threshold: 0.08 },
      );
      io.observe(root);
    }

    return () => {
      cancelled = true;
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("error", onError);
      video.removeEventListener("ended", onEnded);
      io?.disconnect();
      video.pause();
    };
  }, [videoEnabled, videoWebm, videoMp4]);

  const fireflies = useMemo(() => (compact ? FIREFLIES.slice(0, 4) : FIREFLIES), [compact]);
  const smoke = useMemo(() => (compact ? SMOKE.slice(0, 5) : SMOKE), [compact]);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLE }} />
      <div className="ne-hero-fx" ref={rootRef} aria-hidden="true">
        <div className="ne-hero-fx__bg" ref={bgRef}>
          {/* Poster always present to reserve layout / fallback */}
          <img
            src={src}
            alt={alt}
            loading="eager"
            fetchPriority="high"
            decoding="async"
            className={`ne-hero-fx__poster${videoReady ? " ne-hero-fx__poster--hidden" : ""}`}
            draggable={false}
          />
          {videoEnabled && (
            <video
              ref={videoRef}
              className="ne-hero-fx__bg-video"
              poster={src}
              muted
              playsInline
              autoPlay
              loop
              preload="metadata"
              disablePictureInPicture
              disableRemotePlayback
              controls={false}
              tabIndex={-1}
              aria-hidden="true"
            >
              {videoWebm && <source src={videoWebm} type="video/webm" />}
              {videoMp4 && <source src={videoMp4} type="video/mp4" />}
            </video>
          )}
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
          {smoke.map((s, i) => (
            <div
              key={i}
              className={`ne-hero-fx__smoke-plume${s.soft ? " ne-hero-fx__smoke-plume--soft" : ""}`}
              style={{
                left: s.left,
                width: s.width,
                height: s.height,
                animationDelay: s.delay,
                animationDuration: s.duration,
                "--smoke-peak": s.peak,
                "--smoke-mid-x": s.midX,
                "--smoke-end-x": s.endX,
                "--smoke-rot": s.rot,
                "--smoke-rot-end": s.rotEnd,
              } as CssVars}
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
      </div>
    </>
  );
}
