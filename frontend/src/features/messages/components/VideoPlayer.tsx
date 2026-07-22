import { useRef, useState } from "react";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import { SH1 } from "@/app/shared";

export function VideoPlayer({
  src,
  reservedHeight = 200,
  reservedMaxWidth = 320,
}: {
  src?: string;
  /** Fixed frame height so list layout does not jump when metadata loads. */
  reservedHeight?: number;
  reservedMaxWidth?: number;
}) {
  const vidRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const fmt = (s: number) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;

  const togglePlay = () => {
    if (!vidRef.current) return;
    if (playing) { vidRef.current.pause(); setPlaying(false); }
    else { vidRef.current.play().then(() => setPlaying(true)).catch(() => {}); }
  };

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!vidRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    vidRef.current.currentTime = ((e.clientX - rect.left) / rect.width) * duration;
  };

  const toggleMute = () => {
    if (!vidRef.current) return;
    vidRef.current.muted = !muted;
    setMuted(!muted);
  };

  const fullscreen = () => { vidRef.current?.requestFullscreen?.(); };

  return (
    <div
      className="relative bg-black rounded-2xl overflow-hidden max-w-full"
      style={{
        width: `min(100%, ${reservedMaxWidth}px)`,
        maxWidth: reservedMaxWidth,
        height: reservedHeight,
        boxShadow: SH1,
      }}
    >
      <video
        ref={vidRef}
        src={src}
        className="w-full h-full block"
        style={{ display: "block", width: "100%", height: "100%", objectFit: "contain", cursor: "pointer" }}
        onLoadedMetadata={e => { setDuration(e.currentTarget.duration); setLoaded(true); }}
        onTimeUpdate={e => { setCurrentTime(e.currentTarget.currentTime); setProgress(e.currentTarget.currentTime / (e.currentTarget.duration||1) * 100); }}
        onEnded={() => setPlaying(false)}
        onClick={togglePlay}
        muted={muted}
        preload="metadata"
        playsInline
      />
      {/* Center play button when paused */}
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background:"rgba(0,0,0,.55)" }}>
            <PlayArrowIcon style={{ fontSize:28, color:"white" }} />
          </div>
        </div>
      )}
      {/* Bottom controls */}
      <div className="absolute bottom-0 left-0 right-0 flex flex-col gap-1 px-3 pt-4 pb-2" style={{ background:"linear-gradient(transparent,rgba(0,0,0,.75))" }}>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full cursor-pointer relative" style={{ background:"rgba(255,255,255,.25)" }} onClick={seek}>
          <div className="h-full rounded-full transition-none" style={{ width:`${progress}%`, background:"white" }} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={togglePlay} className="text-white hover:opacity-80 transition-opacity">
            {playing ? <PauseIcon style={{ fontSize:18 }} /> : <PlayArrowIcon style={{ fontSize:18 }} />}
          </button>
          <span className="text-white text-[10px] font-mono flex-1">{fmt(currentTime)} / {loaded ? fmt(duration) : "—"}</span>
          <button onClick={toggleMute} className="text-white hover:opacity-80 transition-opacity">
            {muted ? <VolumeOffIcon style={{ fontSize:16 }} /> : <VolumeUpIcon style={{ fontSize:16 }} />}
          </button>
          <button onClick={fullscreen} className="text-white hover:opacity-80 transition-opacity">
            <FullscreenIcon style={{ fontSize:16 }} />
          </button>
        </div>
      </div>
    </div>
  );
}
