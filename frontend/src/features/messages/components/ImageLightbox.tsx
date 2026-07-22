import { useState, useRef, useEffect, useCallback } from "react";
import CloseIcon from "@mui/icons-material/Close";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import { LIGHTBOX_MIN, LIGHTBOX_MAX } from "../constants";
import { getNinja } from "@/shared/electronBridge";

export function ImageLightbox({
  src,
  onClose,
  desktopMode = false,
}: {
  src: string;
  onClose: () => void;
  /** Electron shell: top-right shows only minimize (dropdown) + close. */
  desktopMode?: boolean;
}) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  const dragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const clampScale = (s: number) => Math.min(LIGHTBOX_MAX, Math.max(LIGHTBOX_MIN, s));

  const resetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const rotateCw = useCallback(() => {
    setRotation(r => (r + 90) % 360);
  }, []);

  /** Desktop: minimize to the Windows taskbar (standard window minimize). */
  const minimizePreviewWindow = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    getNinja()?.window?.minimize();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (desktopMode) return;
      if (e.key === "0" || e.key === "Home") resetView();
      if (e.key === "+" || e.key === "=") setScale(s => clampScale(s + 0.25));
      if (e.key === "-" || e.key === "_") setScale(s => clampScale(s - 0.25));
      if (e.key === "r" || e.key === "R") rotateCw();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, resetView, rotateCw, desktopMode]);

  useEffect(() => {
    resetView();
  }, [src, resetView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      setScale(s => {
        const next = clampScale(s + delta);
        if (next <= 1) setOffset({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (scale > 1) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
    } else setScale(2);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    dragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || scale <= 1) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setOffset(o => ({ x: o.x + dx, y: o.y + dy }));
  };

  const onPointerUp = () => { dragging.current = false; };

  const touchDist = (touches: React.TouchList) => {
    if (touches.length < 2) return 0;
    const a = touches[0], b = touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      pinchStart.current = { dist: touchDist(e.touches), scale };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStart.current) {
      e.preventDefault();
      const ratio = touchDist(e.touches) / pinchStart.current.dist;
      const next = clampScale(pinchStart.current.scale * ratio);
      setScale(next);
      if (next <= 1) setOffset({ x: 0, y: 0 });
    }
  };

  const onTouchEnd = () => { pinchStart.current = null; };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 backdrop-blur-sm touch-none"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
        {desktopMode ? (
          <>
            <button
              type="button"
              onClick={minimizePreviewWindow}
              className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10"
              aria-label="Minimize window"
              title="Minimize"
            >
              <KeyboardArrowDownIcon style={{ fontSize: 26 }} />
            </button>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onClose(); }}
              className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10"
              aria-label="Close preview"
              title="Close"
            >
              <CloseIcon style={{ fontSize: 24 }} />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={e => { e.stopPropagation(); setScale(s => clampScale(s - 0.25)); }} className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Zoom out" title="Zoom out">
              <ZoomOutIcon style={{ fontSize: 22 }} />
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); setScale(s => clampScale(s + 0.25)); }} className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Zoom in" title="Zoom in">
              <ZoomInIcon style={{ fontSize: 22 }} />
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); rotateCw(); }} className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Rotate 90 degrees" title="Rotate (R)">
              <RotateRightIcon style={{ fontSize: 22 }} />
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); resetView(); }} className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Reset view" title="Reset view">
              <RestartAltIcon style={{ fontSize: 22 }} />
            </button>
            <button type="button" onClick={e => { e.stopPropagation(); onClose(); }} className="w-10 h-10 flex items-center justify-center rounded-full text-white hover:bg-white/10" aria-label="Close preview">
              <CloseIcon style={{ fontSize: 24 }} />
            </button>
          </>
        )}
      </div>
      {!desktopMode && (
        <span className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-white/80 text-xs font-mono px-3 py-1 rounded-full bg-black/40" aria-live="polite">
          {Math.round(scale * 100)}% · {rotation}°
        </span>
      )}
      <div
        ref={viewportRef}
        className="w-full h-full flex items-center justify-center overflow-hidden"
        onWheel={onWheel}
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <img
          ref={imgRef}
          src={src}
          alt="Preview"
          draggable={false}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`,
            transformOrigin: "center center",
            transition: dragging.current ? "none" : "transform 0.2s ease-out",
            cursor: scale > 1 ? (dragging.current ? "grabbing" : "grab") : "zoom-in",
            willChange: "transform",
          }}
          onDoubleClick={onDoubleClick}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
