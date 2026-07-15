import { useState, useRef, useEffect, useCallback, memo, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import AudioPlayer from "react-h5-audio-player";
import "react-h5-audio-player/lib/styles.css";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import EmojiEmotionsIcon from "@mui/icons-material/EmojiEmotions";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import SettingsIcon from "@mui/icons-material/Settings";
import TagIcon from "@mui/icons-material/Tag";
import ChatBubbleIcon from "@mui/icons-material/ChatBubble";
import GroupsIcon from "@mui/icons-material/Groups";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import BlockIcon from "@mui/icons-material/Block";
import FlagIcon from "@mui/icons-material/Flag";
import DeleteIcon from "@mui/icons-material/Delete";
import PersonIcon from "@mui/icons-material/Person";
import ReplyIcon from "@mui/icons-material/Reply";
import EditIcon from "@mui/icons-material/Edit";
import CheckIcon from "@mui/icons-material/Check";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import FullscreenIcon from "@mui/icons-material/Fullscreen";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import InboxIcon from "@mui/icons-material/Inbox";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import DownloadIcon from "@mui/icons-material/Download";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import RotateRightIcon from "@mui/icons-material/RotateRight";
import CircularProgress from "@mui/material/CircularProgress";
import Badge from "@mui/material/Badge";
import { toast } from "sonner";
import {
  Page, AppSettings, Contact, ColorTheme, useC, useWide, SH1, FilledBtn, OutlinedBtn, Field, ChatAvatar, BADGE_BG, COUNTRY_ISO,
} from "@/app/shared";
import { api, ApiError, type ApiMessage } from "@/app/api";
import { onRealtimeEvent, emitTyping, joinConversation } from "@/app/realtime";
import {
  getConversationReadState,
  saveConversationReadState,
} from "@/app/conversationState";
import { LazyVisible } from "@/app/messaging/LazyVisible";
import { messageCache } from "@/app/messaging/messageCache";
import { msgPerf } from "@/app/messaging/msgPerf";
import { useMessageThread } from "@/app/messaging/useMessageThread";
import { toChatMsg, type ChatMsg } from "@/app/messaging/types";

const STATUS_COLORS: Record<string,string> = { Online:"#386A20", Away:"#F59E0B", "Do Not Disturb":"#B3261E", Offline:"#79747E" };
const COMPOSER_MAX_HEIGHT = 160;

function ConversationDetailsBody({
  sel,
  C,
  presenceColor,
  presenceLabel,
}: {
  sel: Contact;
  C: ColorTheme;
  presenceColor: (c: Contact) => string;
  presenceLabel: (c: Contact) => string;
}) {
  const rows = (sel.type === "dm"
    ? ([
        ["Membership", sel.isTeamMember ? "Team Member" : "Member"],
        sel.rank ? ["Rank", sel.rank] : null,
        sel.village ? ["Village", sel.village] : null,
        sel.clan ? ["Clan", sel.clan] : null,
        sel.level != null ? ["Level", String(sel.level)] : null,
        sel.memberSince ? ["Joined", sel.memberSince] : null,
        sel.country ? ["Country", sel.country] : null,
      ] as ([string, string] | null)[]).filter(Boolean) as [string, string][]
    : ([
        ["Type", "Text Channel"],
        sel.bio ? ["About", sel.bio.slice(0, 80) + (sel.bio.length > 80 ? "…" : "")] : null,
      ] as ([string, string] | null)[]).filter(Boolean) as [string, string][]);

  return (
    <>
      <div className="text-center mb-5">
        <div className="relative inline-block mb-3">
          {sel.type === "channel" ? (
            <ChatAvatar name={sel.name} size={80} channel className="mx-auto" />
          ) : (
            <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={80} className="mx-auto" />
          )}
          {sel.type === "dm" && <FiberManualRecordIcon style={{ fontSize: 14, color: presenceColor(sel), position: "absolute", bottom: 2, right: 2 }} />}
        </div>
        <h3 className="font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{sel.name}</h3>
        <span className="text-xs font-medium" style={{ color: sel.type === "channel" ? C.primary : presenceColor(sel), fontFamily: "Roboto" }}>{presenceLabel(sel)}</span>
        {sel.bio ? <p className="text-xs mt-3 leading-relaxed text-left" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{sel.bio}</p> : null}
      </div>
      <div className="space-y-3 text-sm border-t pt-4" style={{ borderColor: C.outlineVar }}>
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3">
            <span className="shrink-0" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{k}</span>
            <span className="font-medium text-right" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{v}</span>
          </div>
        ))}
        {sel.type === "dm" && !sel.village && !sel.memberSince && !sel.rank && (
          <p className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No additional profile details available.</p>
        )}
      </div>
    </>
  );
}

// GIF data for picker (public Tenor-style placeholders via known Giphy public beta embeds)
const EMOJI_TABS = ["😀","🎉","❤️","🔥","⚔️","🛡️","🎮","💀"] as const;
const EMOJI_LIST = [
  "😀","😂","🤣","😍","🤩","😎","😠","🤔","😅","😭","😤","🤯",
  "🎉","🎊","🎮","🏆","⚔️","🛡️","🔥","💀","👑","💎","🌟","⭐",
  "❤️","🧡","💛","💚","💙","💜","🖤","💔","💤","✅","💢","💞",
  "👍","👎","👏","🙌","🤝","✌️","🤟","💪","🦾","🙏","🤝","🤜",
  "🐉","🦊","🐺","🦅","🌙","⚡","🌊","🌸","🍃","🏯","🗡️","🚗",
];
const GIF_LIST = [
  { label:"Tawffie", url:"https://c.tenor.com/3Pl2VYPfS4gAAAAd/tenor.gif" },
  { label:"Chou Kaguya", url:"https://c.tenor.com/fAS0_kCyse8AAAAd/tenor.gif" },
  { label:"Wink Anime", url:"https://c.tenor.com/P7hCyZlzDH4AAAAd/tenor.gif" },
  { label:"D Sad", url:"https://media.tenor.com/laNVq3HwQ_EAAAAj/d-sad.gif" },
  { label:"Thinking About It", url:"https://media.tenor.com/qHsyLvSQDKsAAAAj/thinking-about-it-cute-anime-boy.gif" },
  { label:"Konata Lucky Star", url:"https://c.tenor.com/2ZuUWp5LDfIAAAAd/tenor.gif" },
  { label:"GIF Lucky Star", url:"https://c.tenor.com/AUwe8tYasOkAAAAd/tenor.gif" },
  { label:"Pout Meme", url:"https://c.tenor.com/d_pL1WslyB8AAAAd/tenor.gif" },
  { label:"Spy X Family", url:"https://c.tenor.com/jY8tXM6lf50AAAAd/tenor.gif" },
  { label:"Girl Tsundere", url:"https://c.tenor.com/Hh_rXuLj3jAAAAAd/tenor.gif" },
  { label:"Mistress Kanan", url:"https://c.tenor.com/XBxviFj8awMAAAAd/tenor.gif" },
  { label:"Anya Forger Spy X Family GIF", url:"https://c.tenor.com/4Hrmee80yr4AAAAd/tenor.gif" },
  { label:"Happy Blue Hair", url:"https://media.tenor.com/3IWwpnzTzqYAAAAM/happy-blue-hair.gif" },
  { label:"Sleepy Anime", url:"https://media.tenor.com/kxS7zmPc1WMAAAAM/anime-sleepy.gif" },
  { label:"Yes", url:"https://media.tenor.com/1tuKwrjR9VsAAAAM/anime-boy.gif" },
  { label:"I Hate In My Class", url:"https://media.tenor.com/rtHwrLRPlAkAAAAM/class-no-daikirai-na-joshi-to-kekkon-suru-koto-ni-natta-i%27m-getting-married-to-a-girl-i-hate-in-my-class.gif" },
  { label:"Girl Wave", url:"https://media.tenor.com/7dr3AgyEiN0AAAAm/anime-girl-wave.webp" },
  { label:"Good Morning", url:"https://c.tenor.com/K3VP_Sv1EnkAAAAd/tenor.gif" },
  { label:"Good Night", url:"https://c.tenor.com/ZJNdqYAPzAEAAAAC/tenor.gif" },
];

type ChatMsg = {
  id: number; userId?: number; user: string; msg: string; time: string; self: boolean;
  avatarUrl?: string | null;
  mediaUrl?: string; mediaType?: "image"|"video"|"audio"|"gif"|"file";
  fileName?: string; fileSize?: number;
  replyTo?: { id: number; user: string; preview: string };
  edited?: boolean;
  reactions?: Record<string, string[]>;
};

const URL_SPLIT = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/g;
const URL_TEST = /^https?:\/\//;

function TextWithLinks({ text, fg }: { text: string; fg: string }) {
  const parts = text.split(URL_SPLIT);
  return (
    <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      {parts.map((p, i) => URL_TEST.test(p)
        ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color:fg, opacity:0.85 }}>{p}</a>
        : p
      )}
    </span>
  );
}

function LinkPreviewCard({ text, self, C }: { text: string; self: boolean; C: ColorTheme }) {
  const match = text.match(URL_SPLIT);
  if (!match) return null;
  const url = match[0];
  let domain = "";
  try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-start gap-3 mt-2 px-3 py-2.5 rounded-xl border no-underline hover:opacity-80 transition-opacity min-w-0 max-w-full" style={{ background: self ? "rgba(255,255,255,.12)" : C.surfaceVar, borderColor: self ? "rgba(255,255,255,.2)" : C.outlineVar, textDecoration:"none" }}>
      <img src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`} alt="" className="w-5 h-5 rounded mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium truncate" style={{ color: self ? "rgba(255,255,255,.9)" : C.primary, fontFamily:"Roboto" }}>{domain}</p>
        <p className="text-[10px] truncate opacity-70" style={{ color: self ? "white" : C.onSurfaceVar, fontFamily:"Roboto" }}>{url}</p>
      </div>
      <OpenInNewIcon style={{ fontSize:14, color: self ? "rgba(255,255,255,.6)" : C.onSurfaceVar, marginLeft:"auto", flexShrink:0 }} />
    </a>
  );
}

const FILE_ICONS: Record<string,string> = { zip:"🗜️", rar:"🗜️", "7z":"🗜️", gz:"🗜️", tar:"🗜️", exe:"⚙️", msi:"⚙️", dmg:"🍎", apk:"📱", pdf:"📄", doc:"📝", docx:"📝", xls:"📊", xlsx:"📊", ppt:"📑", pptx:"📑", txt:"📄", csv:"📊", json:"💾", xml:"💾", mp3:"🎵", wav:"🎵", ogg:"🎵", default:"📎" };
function fileIcon(name:string){ const ext=(name.split(".").pop()||"").toLowerCase(); return FILE_ICONS[ext]||FILE_ICONS.default; }
function fmtSize(b:number){ if(b<1024) return b+"B"; if(b<1048576) return (b/1024).toFixed(1)+"KB"; return (b/1048576).toFixed(1)+"MB"; }

// ── Flag image helper ─────────────────────────────────────────────────────────
function FlagImg({ country, size=20 }: { country:string; size?:number }) {
  const iso = (COUNTRY_ISO[country] || "").toLowerCase();
  if (!iso) return <span className="text-base">🌐</span>;
  return <img src={`https://flagcdn.com/w${size}/${iso}.png`} alt={country} width={size} height={Math.round(size * 0.67)} className="rounded-sm object-cover shrink-0" style={{ display:"inline-block" }} />;
}

// ── Custom video player ───────────────────────────────────────────────────────
function VideoPlayer({ src }: { src?: string }) {
  const C = useC();
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
    <div className="relative bg-black rounded-2xl overflow-hidden max-w-full" style={{ maxWidth: 320, width: "fit-content", boxShadow: SH1 }}>
      <video
        ref={vidRef}
        src={src}
        className="w-full block"
        style={{ display:"block", minHeight:120, maxHeight:240, cursor:"pointer" }}
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

function FileBubble({ msg, self, C }: { msg:ChatMsg; self:boolean; C:ColorTheme }) {
  const [open, setOpen] = useState(false);
  const bg = self ? C.primary : C.surface;
  const fg = self ? "white" : C.onSurface;
  const fgSub = self ? "rgba(255,255,255,.7)" : C.onSurfaceVar;
  const name = msg.fileName || "file";
  const size = msg.fileSize ? fmtSize(msg.fileSize) : "";
  return (
    <div className="max-w-[min(260px,100%)] min-w-0">
      <button onClick={() => setOpen(o=>!o)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:opacity-90" style={{ background:bg, boxShadow:SH1 }}>
        <span className="text-2xl shrink-0">{fileIcon(name)}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color:fg, fontFamily:"Roboto" }}>{name}</p>
          {size && <p className="text-[11px]" style={{ color:fgSub, fontFamily:"Roboto" }}>{size}</p>}
        </div>
        <span style={{ color:fgSub, fontSize:18 }}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div className="rounded-b-2xl border-t px-4 py-3 flex items-center gap-3" style={{ background: self?"rgba(0,0,0,.15)":C.surfaceVar, borderColor: self?"rgba(255,255,255,.2)":C.outlineVar }}>
          <a href={msg.mediaUrl} download={name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium no-underline hover:opacity-80 transition-opacity" style={{ background:self?"rgba(255,255,255,.2)":C.primaryCont, color:self?"white":C.primary, fontFamily:"Roboto" }}>
            <DownloadIcon style={{ fontSize:14 }} /> Download
          </a>
          <span className="text-[11px]" style={{ color:fgSub, fontFamily:"Roboto" }}>{name.split(".").pop()?.toUpperCase()} file</span>
        </div>
      )}
    </div>
  );
}

const QUICK_REACTIONS = ["👍","❤️","😂","😮","😢","🔥","🤯","🏆"];

function MediaBubble({ msg, self, C, onScrollTo, onLightbox }: { msg:ChatMsg; self:boolean; C:ColorTheme; onScrollTo?:(id:number)=>void; onLightbox?:(url:string)=>void }) {
  const bg = self ? C.primary : C.surface;
  const fg = self ? (C.bg === "#FFFBFE" ? "white" : C.onPrimary) : C.onSurface;
  const corner = self ? "rounded-[20px_4px_20px_20px]" : "rounded-[4px_20px_20px_20px]";
  const hasLink = URL_SPLIT.test(msg.msg); URL_SPLIT.lastIndex = 0;
  const isLight = C.bg === "#FFFBFE";
  const replyUsesSelfStyle = self && !isLight;
  const replyPreviewColor = replyUsesSelfStyle ? "white" : C.onSurfaceVar;
  const voiceFg = self ? (isLight ? "#FFFFFF" : C.onPrimary) : C.onSurface;
  const replyBlock = msg.replyTo ? (
    <button onClick={() => onScrollTo?.(msg.replyTo!.id)} className={`w-full min-w-0 max-w-full text-left px-3 py-1.5 mb-1 rounded-xl border-l-4 text-xs cursor-pointer hover:opacity-80 transition-opacity ${replyUsesSelfStyle ? "rounded-[16px_4px_4px_16px]" : "rounded-[4px_16px_16px_4px]"}`} style={{ background: replyUsesSelfStyle ? "rgba(255,255,255,.15)" : C.surfaceVar, borderColor: replyUsesSelfStyle ? "rgba(255,255,255,.5)" : C.primary }}>
      <span className="font-medium block truncate" style={{ color: replyUsesSelfStyle ? "rgba(255,255,255,.9)" : C.primary, fontFamily:"Roboto" }}>{msg.replyTo.user}</span>
      <span className="truncate block" style={{ color: replyPreviewColor, fontFamily:"Roboto", opacity: replyUsesSelfStyle ? 0.8 : 1 }}>{msg.replyTo.preview || "📎 Attachment"}</span>
    </button>
  ) : null;

  /** Shrink-wrap media to content width so parent `items-end` / outgoing alignment works for all types. */
  const shell = (body: ReactNode) => (
    <div className={`flex flex-col min-w-0 max-w-full ${self ? "items-end" : "items-start"}`}>
      <div style={{ width: "fit-content", maxWidth: "100%" }}>
        {replyBlock}
        {body}
      </div>
    </div>
  );

  if (msg.mediaType === "file") return shell(<FileBubble msg={msg} self={self} C={C} />);
  if (msg.mediaType === "image") return shell(
    <LazyVisible placeholderHeight={200}>
      <div
        className="cursor-zoom-in overflow-hidden rounded-2xl"
        style={{ maxWidth: 420, width: "fit-content", boxShadow: SH1 }}
        onClick={() => msg.mediaUrl && onLightbox?.(msg.mediaUrl)}
      >
        <img
          src={msg.mediaUrl}
          alt=""
          className="block hover:brightness-90 transition-all"
          style={{ width: "auto", height: "auto", maxWidth: "100%", maxHeight: 360, verticalAlign: "middle" }}
          decoding="async"
          loading="lazy"
        />
        {msg.msg && <div className="px-3 py-1.5 text-sm min-w-0 text-left" style={{ background: bg, color: fg, fontFamily: "Roboto" }}><TextWithLinks text={msg.msg} fg={fg} /></div>}
      </div>
    </LazyVisible>
  );
  if (msg.mediaType === "video") return shell(
    <LazyVisible placeholderHeight={200}>
      <VideoPlayer src={msg.mediaUrl} />
      {msg.msg && <div className="px-3 py-1.5 text-sm rounded-b-2xl max-w-[min(320px,100%)] min-w-0" style={{ background:bg, color:fg, fontFamily:"Roboto" }}><TextWithLinks text={msg.msg} fg={fg} /></div>}
    </LazyVisible>
  );
  if (msg.mediaType === "audio") return shell(
    <LazyVisible placeholderHeight={72}>
      <div className={`voice-msg rounded-2xl overflow-hidden ${corner} ${self ? "voice-msg--self" : "voice-msg--peer"}`} style={{ boxShadow:SH1, background: bg, color: voiceFg, width: "min(300px, 100%)" }}>
        <AudioPlayer src={msg.mediaUrl} showJumpControls={false} customAdditionalControls={[]} layout="horizontal-reverse" style={{ background: "transparent", boxShadow:"none", width: "100%", color: voiceFg }} />
        {msg.msg && <div className="px-3 py-1.5 text-sm min-w-0" style={{ background:bg, color:fg, fontFamily:"Roboto" }}><TextWithLinks text={msg.msg} fg={fg} /></div>}
      </div>
    </LazyVisible>
  );
  if (msg.mediaType === "gif") return shell(
    <LazyVisible placeholderHeight={160}>
      <div className="overflow-hidden rounded-2xl" style={{ maxWidth: 320, width: "fit-content", boxShadow: SH1 }}>
        <img src={msg.mediaUrl} alt="gif" className="block" style={{ width: "auto", height: "auto", maxWidth: "100%" }} loading="lazy" decoding="async" />
      </div>
    </LazyVisible>
  );
  if (!msg.msg) return null;
  return shell(
    <div className={`px-4 py-2.5 text-sm min-w-0 max-w-full ${corner}`} style={{ background:bg, color:fg, fontFamily:"Roboto", boxShadow:SH1 }}>
      <TextWithLinks text={msg.msg} fg={fg} />
      {msg.edited && <span className="text-[9px] opacity-60 ml-1">(edited)</span>}
      {hasLink && <LinkPreviewCard text={msg.msg} self={self} C={C} />}
    </div>
  );
}

const LIGHTBOX_MIN = 1;
const LIGHTBOX_MAX = 5;

function useScrollReveal() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.currentTarget;
    el.classList.add("is-scrolling");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => el.classList.remove("is-scrolling"), 900);
  }, []);
}

function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "0" || e.key === "Home") resetView();
      if (e.key === "+" || e.key === "=") setScale(s => clampScale(s + 0.25));
      if (e.key === "-" || e.key === "_") setScale(s => clampScale(s - 0.25));
      if (e.key === "r" || e.key === "R") rotateCw();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, resetView, rotateCw]);

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
      </div>
      <span className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 text-white/80 text-xs font-mono px-3 py-1 rounded-full bg-black/40" aria-live="polite">
        {Math.round(scale * 100)}% · {rotation}°
      </span>
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
type ListFilter = "all" | "channel" | "dm" | "dm-requests";

type MessageRowProps = {
  m: ChatMsg;
  prev?: ChatMsg;
  lastReadMessageId: number | null;
  currentUserId: number;
  isMobile: boolean;
  C: ColorTheme;
  editingId: number | null;
  editText: string;
  setEditText: (v: string) => void;
  setEditingId: (id: number | null) => void;
  registerRef: (id: number, el: HTMLDivElement | null) => void;
  onScrollTo: (id: number) => void;
  onLightbox: (url: string) => void;
  onReply: (m: ChatMsg) => void;
  onReact: (id: number, emoji: string) => void;
  onDelete: (id: number) => void;
  onReport: (id: number) => void;
  onCommitEdit: (id: number) => void;
  onOpenProfile: (m: ChatMsg) => void | Promise<void>;
};

const MessageRow = memo(function MessageRow({
  m,
  prev,
  lastReadMessageId,
  currentUserId,
  isMobile,
  C,
  editingId,
  editText,
  setEditText,
  setEditingId,
  registerRef,
  onScrollTo,
  onLightbox,
  onReply,
  onReact,
  onDelete,
  onReport,
  onCommitEdit,
  onOpenProfile,
}: MessageRowProps) {
  const [hovered, setHovered] = useState(false);
  const [reactionOpen, setReactionOpen] = useState(false);
  const showHeader = !prev || prev.user !== m.user || prev.time !== m.time;
  const showUnreadDivider = !!(
    lastReadMessageId
    && !m.self
    && m.id > lastReadMessageId
    && (!prev || prev.id <= lastReadMessageId || prev.self)
  );

  return (
    <div className="pb-3 min-w-0 max-w-full">
      {showUnreadDivider && (
        <div className="flex items-center gap-3 my-3">
          <div className="flex-1 h-px" style={{ background: C.error }} />
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: C.error, fontFamily: "Roboto" }}>New</span>
          <div className="flex-1 h-px" style={{ background: C.error }} />
        </div>
      )}
      <div className={`flex gap-2.5 min-w-0 max-w-full ${m.self ? "flex-row-reverse" : ""}`}>
        {!m.self ? (
          showHeader
            ? (
              <button
                type="button"
                className="self-end shrink-0 rounded-full focus:outline-none focus-visible:ring-2 p-0 border-0 bg-transparent"
                onClick={e => { e.stopPropagation(); void onOpenProfile(m); }}
                aria-label={isMobile ? `View ${m.user}'s profile` : undefined}
                tabIndex={isMobile ? 0 : -1}
                style={{ cursor: isMobile ? "pointer" : "default" }}
              >
                <ChatAvatar name={m.user} avatarUrl={m.avatarUrl} size={32} />
              </button>
            )
            : <div className="w-8 shrink-0" />
        ) : <div className="w-8 shrink-0" />}
        <div className={`flex flex-col gap-1 min-w-0 max-w-[min(100%,20rem)] lg:max-w-md ${m.self ? "items-end" : "items-start"}`}>
          {showHeader && (
            <span className="text-[11px] mb-0.5 mx-1 flex items-center gap-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <span style={{ fontFamily: "Roboto Mono,monospace" }}>{m.time}</span>
              {!m.self && <span>{m.user}</span>}
            </span>
          )}
          <div
            ref={el => registerRef(m.id, el)}
            className="relative min-w-0 max-w-full"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => { setHovered(false); setReactionOpen(false); }}
          >
            {hovered && (
              <div className="absolute -top-8 right-0 flex items-center gap-0.5 px-1.5 py-1 rounded-full shadow-lg z-20" style={{ background: C.surface, border: `1px solid ${C.outlineVar}` }}>
                <div className="relative">
                  <button title="React" onClick={e => { e.stopPropagation(); setReactionOpen(o => !o); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors text-sm" style={{ color: C.onSurfaceVar }}>😊</button>
                  {reactionOpen && (
                    <div
                      className={`absolute bottom-full mb-1 flex gap-1 px-2 py-1.5 rounded-full shadow-lg ${m.self ? "right-0" : "left-0"}`}
                      style={{ background: C.surface, border: `1px solid ${C.outlineVar}` }}
                      onClick={e => e.stopPropagation()}
                    >
                      {QUICK_REACTIONS.map(emoji => (
                        <button key={emoji} onClick={() => { onReact(m.id, emoji); setReactionOpen(false); }} className="text-lg hover:scale-125 transition-transform w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/8">{emoji}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button title="Reply" onClick={e => { e.stopPropagation(); onReply(m); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.onSurfaceVar }}><ReplyIcon style={{ fontSize: 14 }} /></button>
                {m.self && editingId !== m.id && (
                  <button title="Edit" onClick={e => { e.stopPropagation(); setEditingId(m.id); setEditText(m.msg); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.onSurfaceVar }}><EditIcon style={{ fontSize: 14 }} /></button>
                )}
                {m.self && (
                  <button title="Delete" onClick={e => { e.stopPropagation(); onDelete(m.id); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.error }}><DeleteIcon style={{ fontSize: 14 }} /></button>
                )}
                {!m.self && (
                  <button title="Report" onClick={e => { e.stopPropagation(); onReport(m.id); }} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8 transition-colors" style={{ color: C.error }}><FlagIcon style={{ fontSize: 14 }} /></button>
                )}
              </div>
            )}
            {editingId === m.id ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-2xl border min-w-0 max-w-full" style={{ background: C.surfaceVar, borderColor: C.primary }}>
                <input autoFocus value={editText} onChange={e => setEditText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") onCommitEdit(m.id); if (e.key === "Escape") setEditingId(null); }} className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none" style={{ color: C.onSurface, fontFamily: "Roboto" }} />
                <button onClick={() => onCommitEdit(m.id)} className="w-6 h-6 flex items-center justify-center rounded-full text-white shrink-0" style={{ background: C.primary }}><CheckIcon style={{ fontSize: 12 }} /></button>
                <button onClick={() => setEditingId(null)} className="w-6 h-6 flex items-center justify-center rounded-full shrink-0" style={{ background: C.surfaceVar, color: C.onSurfaceVar }}><CloseIcon style={{ fontSize: 12 }} /></button>
              </div>
            ) : (
              <div>
                <MediaBubble msg={m} self={m.self} C={C} onScrollTo={onScrollTo} onLightbox={onLightbox} />
                {m.reactions && Object.keys(m.reactions).length > 0 && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${m.self ? "justify-end" : "justify-start"}`}>
                    {Object.entries(m.reactions).map(([emoji, users]) => (
                      <button key={emoji} onClick={() => onReact(m.id, emoji)} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all hover:scale-105" style={{ background: users.includes(String(currentUserId)) ? C.primaryCont : C.surface, borderColor: users.includes(String(currentUserId)) ? C.primary : C.outlineVar, color: C.onSurface, fontFamily: "Roboto" }}>
                        <span>{emoji}</span><span className="font-medium">{users.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function MessagesPage({ settings, showEmailToast, showPushNotif, contacts, setContacts, onUnreadChange, onConversationsRefresh, currentUserId, currentUser, onUserUpdate, initialConversationId, focusInput, onFocusHandled, onInitialConversationHandled }: {
  settings: AppSettings;
  showEmailToast: (title:string, body:string, page:Page)=>void;
  showPushNotif: (title:string, body:string, page:Page)=>void;
  contacts: Contact[];
  setContacts: React.Dispatch<React.SetStateAction<Contact[]>>;
  onUnreadChange?: (n: number) => void;
  /** Shared App-level coalesced conversation refresh (avoids duplicate list fetches). */
  onConversationsRefresh?: () => void;
  currentUserId: number;
  currentUser?: import("@/app/api").ApiUser | null;
  onUserUpdate?: (u: import("@/app/api").ApiUser) => void;
  initialConversationId?: number | null;
  focusInput?: boolean;
  onFocusHandled?: () => void;
  onInitialConversationHandled?: () => void;
}) {
  const C = useC();
  const isMobile = !useWide(767);
  const onScrollReveal = useScrollReveal();
  const virtuosoScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const emptyContact: Contact = { id: 0, name: "Select a conversation", msg: "", time: "", unread: 0, online: false, bio: "", type: "dm" };
  const [sel, setSel] = useState<Contact>(contacts[0] ?? emptyContact);
  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsContact, setDetailsContact] = useState<Contact | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [myStatus, setMyStatus] = useState(currentUser?.status || "Online");
  const [myBio, setMyBio] = useState(currentUser?.bio || "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [emojiTab, setEmojiTab] = useState<"emoji"|"gif">("emoji");
  const [replyingTo, setReplyingTo] = useState<ChatMsg|null>(null);
  const [editingId, setEditingId] = useState<number|null>(null);
  const [editText, setEditText] = useState("");
  const [headerMenu, setHeaderMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState<{x:number;y:number;contact:Contact}|null>(null);
  const [confirm, setConfirm] = useState<{title:string;body:string;onOk:()=>void}|null>(null);
  const [lightbox, setLightbox] = useState<string|null>(null);
  const [listFilter, setListFilter] = useState<ListFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [newDmUsername, setNewDmUsername] = useState("");
  const [newDmError, setNewDmError] = useState("");
  const [newDmLoading, setNewDmLoading] = useState(false);
  const [dmRequests, setDmRequests] = useState<{ id: number; requesterId: number; requesterName: string; requesterAvatar?: string | null; requesterDisplayName?: string; time: string }[]>([]);
  const [typingUsers, setTypingUsers] = useState<{ userId: number; username: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const emojiBtnRef = useRef<HTMLButtonElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const [emojiPickerPos, setEmojiPickerPos] = useState<{ right: number; bottom: number }>({ right: 20, bottom: 72 });
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const msgRefs = useRef<Map<number,HTMLDivElement>>(new Map());
  const selIdRef = useRef(sel.id);
  const refreshContactsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedReadRef = useRef<number | null>(null);

  const refreshContacts = useCallback(() => {
    // Prefer shared App coalescer when available so Messages + shell share one fetch.
    if (onConversationsRefresh) {
      onConversationsRefresh();
      return;
    }
    if (refreshContactsTimer.current) clearTimeout(refreshContactsTimer.current);
    refreshContactsTimer.current = setTimeout(() => {
      refreshContactsTimer.current = null;
      api.messages.conversations()
        .then(r => {
          setContacts(r.conversations as Contact[]);
          onUnreadChange?.(r.conversations.filter(c => c.type === "dm").reduce((sum, c) => sum + c.unread, 0));
        })
        .catch(() => {});
    }, 350);
  }, [setContacts, onUnreadChange, onConversationsRefresh]);

  /** Coalesce read receipts — avoid hammering /read while pinned to bottom under traffic. */
  const scheduleMarkRead = useCallback((conversationId: number) => {
    if (!conversationId) return;
    if (lastMarkedReadRef.current === conversationId && markReadTimer.current) return;
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    markReadTimer.current = setTimeout(() => {
      markReadTimer.current = null;
      lastMarkedReadRef.current = conversationId;
      api.messages.markRead(conversationId).then(() => refreshContacts()).catch(() => {});
    }, 500);
  }, [refreshContacts]);

  const thread = useMessageThread({
    conversationId: sel.id,
    currentUserId,
    onContactsRefresh: refreshContacts,
  });

  const {
    msgs, msgsRef,
    hasMoreOlder, hasMoreNewer, loadingOlder, loadingNewer,
    threadReady, threadBootId, initialScrollIndex,
    lastReadMessageId, setLastReadMessageId,
    firstItemIndex, firstItemIndexRef,
    showJumpBtn, setShowJumpBtn,
    unreadBelow, setUnreadBelow,
    isNearBottomRef, pinToBottomRef, visibleStartDataIndexRef,
    loadOlderMessages, loadNewerMessages,
    applyNewMessage, applyUpdatedMessage, applyDeletedMessage, applyReaction,
    jumpToLatest, appendLocal, updateLocal,
  } = thread;

  useEffect(() => { selIdRef.current = sel.id; }, [sel.id]);

  useEffect(() => {
    if (currentUser) {
      setMyStatus(currentUser.status || "Online");
      setMyBio(currentUser.bio || "");
    }
  }, [currentUser]);

  const adjustComposerHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
  }, []);

  const forceScrollToBottom = useCallback((behavior: "auto" | "smooth" = "auto") => {
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    setShowJumpBtn(false);
    setUnreadBelow(0);
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior });
  }, [pinToBottomRef, isNearBottomRef, setShowJumpBtn, setUnreadBelow]);

  const persistConversation = useCallback((conversationId: number) => {
    const list = msgsRef.current;
    if (!conversationId || !list.length || !currentUserId) return;
    const atBottom = isNearBottomRef.current;
    const start = Math.max(0, Math.min(list.length - 1, visibleStartDataIndexRef.current));
    const anchor = list[start]?.id ?? list[list.length - 1].id;
    const newest = list[list.length - 1].id;
    const prev = getConversationReadState(currentUserId, conversationId);
    saveConversationReadState(currentUserId, conversationId, {
      anchorMessageId: anchor,
      atBottom,
      lastReadMessageId: atBottom ? newest : (prev?.lastReadMessageId ?? anchor),
      lastOpenedAt: Date.now(),
    });
  }, [currentUserId, msgsRef, isNearBottomRef, visibleStartDataIndexRef]);

  useEffect(() => {
    const convId = sel.id;
    return () => { if (convId) persistConversation(convId); };
  }, [sel.id, persistConversation]);

  useEffect(() => {
    if (!initialConversationId) return;
    const target = contacts.find(c => c.id === initialConversationId);
    if (!target) return;
    setSel(target);
    setListFilter(target.type === "dm" ? "dm" : "all");
    if (isMobile) setShowSidebar(false);
    onInitialConversationHandled?.();
  }, [initialConversationId, contacts, onInitialConversationHandled, isMobile]);

  useEffect(() => {
    if (focusInput) {
      setTimeout(() => { inputRef.current?.focus(); onFocusHandled?.(); }, 100);
    }
  }, [focusInput, sel.id, onFocusHandled]);

  useEffect(() => {
    if (contacts.length && !contacts.find(c => c.id === sel.id)) {
      setSel(contacts[0]);
    } else if (!contacts.length) {
      setSel(emptyContact);
    }
  }, [contacts, sel.id]);

  const loadDmRequests = () => {
    api.dm.listRequests()
      .then(r => setDmRequests(r.incoming))
      .catch(() => setDmRequests([]));
  };

  useEffect(() => { loadDmRequests(); }, []);

  useEffect(() => {
    if (dmRequests.length === 0 && listFilter === "dm-requests") setListFilter("all");
  }, [dmRequests.length, listFilter]);

  useEffect(() => {
    const unsubs = [
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:new", ({ conversationId, message }) => {
        if (conversationId === selIdRef.current) {
          applyNewMessage(message);
          const isSelf = message.userId === currentUserId;
          if (isNearBottomRef.current || isSelf) {
            pinToBottomRef.current = true;
            requestAnimationFrame(() => forceScrollToBottom("auto"));
            if (!isSelf) {
              scheduleMarkRead(conversationId);
              setLastReadMessageId(message.id);
            }
          } else if (!isSelf) {
            setUnreadBelow(n => n + 1);
            setShowJumpBtn(true);
          }
        }
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number; message: ApiMessage }>("message:updated", ({ conversationId, message }) => {
        if (conversationId === selIdRef.current) applyUpdatedMessage(message);
        else messageCache.upsertMessage(conversationId, toChatMsg(message, currentUserId));
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number }>("message:deleted", ({ conversationId, messageId }) => {
        if (conversationId === selIdRef.current) applyDeletedMessage(messageId);
        else messageCache.removeMessage(conversationId, messageId);
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number; messageId: number; reactions: Record<string, string[]> }>("message:reaction", ({ conversationId, messageId, reactions }) => {
        if (conversationId === selIdRef.current) applyReaction(messageId, reactions);
        else messageCache.patchMessage(conversationId, messageId, { reactions });
      }),
      // conversation:update is owned by App shell — avoid a second list fetch here
      onRealtimeEvent<{ conversationId: number }>("conversation:new", ({ conversationId }) => {
        joinConversation(conversationId);
        refreshContacts();
      }),
      onRealtimeEvent<{ conversationId: number; userId: number; username: string; typing: boolean }>("typing", ({ conversationId, userId, username, typing }) => {
        if (conversationId !== selIdRef.current || userId === currentUserId) return;
        setTypingUsers(prev => {
          const filtered = prev.filter(u => u.userId !== userId);
          return typing ? [...filtered, { userId, username }] : filtered;
        });
      }),
      onRealtimeEvent("dm_request:new", () => loadDmRequests()),
      onRealtimeEvent("dm_request:resolved", () => loadDmRequests()),
      onRealtimeEvent<{ userId: number; status: string; online: boolean }>("presence:update", ({ userId, status, online }) => {
        setContacts(prev => {
          let changed = false;
          const next = prev.map(c => {
            if (c.type !== "dm" || c.otherUserId !== userId) return c;
            if (c.online === online && c.status === status) return c;
            changed = true;
            return { ...c, online, status };
          });
          return changed ? next : prev;
        });
        setSel(prev => {
          if (prev.otherUserId !== userId) return prev;
          if (prev.online === online && prev.status === status) return prev;
          return { ...prev, online, status };
        });
      }),
    ];
    return () => {
      unsubs.forEach(u => u());
      if (refreshContactsTimer.current) clearTimeout(refreshContactsTimer.current);
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      if (isTypingRef.current && selIdRef.current) {
        isTypingRef.current = false;
        emitTyping(selIdRef.current, false);
      }
    };
  }, [
    currentUserId, applyNewMessage, applyUpdatedMessage, applyDeletedMessage, applyReaction,
    forceScrollToBottom, refreshContacts, scheduleMarkRead, setContacts, setLastReadMessageId, setUnreadBelow,
    setShowJumpBtn, isNearBottomRef, pinToBottomRef,
  ]);

  useEffect(() => {
    if (!emojiOpen || !emojiBtnRef.current) return;
    const rect = emojiBtnRef.current.getBoundingClientRect();
    const pickerW = 320;
    const margin = 8;
    let right = window.innerWidth - rect.right;
    if (rect.right - pickerW < margin) right = Math.max(margin, window.innerWidth - pickerW - margin);
    setEmojiPickerPos({ right, bottom: window.innerHeight - rect.top + margin });
  }, [emojiOpen]);

  useEffect(() => { setTypingUsers([]); }, [sel.id]);

  const saveMyProfile = async () => {
    setSavingProfile(true);
    try {
      const { user: updated } = await api.users.update({ status: myStatus, bio: myBio });
      onUserUpdate?.(updated);
      setSettingsOpen(false);
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const presenceColor = (c: Contact) => {
    if (c.type !== "dm") return C.outline;
    return STATUS_COLORS[c.status || (c.online ? "Online" : "Offline")] || C.outline;
  };

  const presenceLabel = (c: Contact) => {
    if (c.type === "channel") return "Text Channel";
    return c.status || (c.online ? "Online" : "Offline");
  };

  const selectConversation = useCallback((m: Contact) => {
    setSel(m);
    if (isMobile) setShowSidebar(false);
  }, [isMobile]);

  const openConversationDetails = useCallback(() => {
    if (!isMobile || sel.id <= 0) return;
    setDetailsContact(sel);
    setDetailsOpen(true);
  }, [isMobile, sel]);

  const apiUserToContact = useCallback((user: import("@/app/api").ApiUser, fallback?: Partial<Contact>): Contact => ({
    id: -(user.id || 0),
    name: user.username,
    msg: "",
    time: "",
    unread: 0,
    online: (user.status || "Online") === "Online",
    bio: user.bio || "",
    type: "dm",
    avatarUrl: user.avatarUrl ?? fallback?.avatarUrl,
    otherUserId: user.id,
    status: user.status,
    village: user.village,
    clan: user.clan,
    level: user.level,
    rank: user.rank,
    memberSince: user.memberSince,
    isTeamMember: user.isTeamMember,
    country: user.country,
    city: user.city,
  }), []);

  const openUserProfileFromMessage = useCallback(async (m: ChatMsg) => {
    if (!isMobile || m.self) return;
    const userId = m.userId;
    if (!userId) {
      // Fall back to conversation peer only for DMs when metadata lacks userId
      if (sel.type === "dm" && sel.id > 0) {
        setDetailsContact(sel);
        setDetailsOpen(true);
      }
      return;
    }
    const existing = contacts.find(c => c.type === "dm" && c.otherUserId === userId);
    if (existing) {
      setDetailsContact(existing);
      setDetailsOpen(true);
      return;
    }
    const provisional: Contact = {
      id: -userId,
      name: m.user,
      msg: "",
      time: "",
      unread: 0,
      online: false,
      bio: "",
      type: "dm",
      avatarUrl: m.avatarUrl,
      otherUserId: userId,
    };
    setDetailsContact(provisional);
    setDetailsOpen(true);
    try {
      const { user } = await api.users.get(userId);
      setDetailsContact(apiUserToContact(user, { avatarUrl: m.avatarUrl }));
    } catch {
      /* keep provisional profile from message metadata */
    }
  }, [isMobile, sel, contacts, apiUserToContact]);

  const dismissConversationDetails = useCallback(() => {
    if (typeof window !== "undefined" && window.history.state && (window.history.state as { msgDetails?: boolean }).msgDetails) {
      window.history.back();
    } else {
      setDetailsOpen(false);
      setDetailsContact(null);
    }
  }, []);

  useEffect(() => {
    if (!detailsOpen) return;
    window.history.pushState({ ...(window.history.state || {}), msgDetails: true }, "");
    const onPop = () => {
      setDetailsOpen(false);
      setDetailsContact(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [detailsOpen]);

  const showLeftPanel = isMobile ? showSidebar : true;
  const showConversationList = showSidebar;
  const showChatPane = !isMobile || !showSidebar;

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!sel?.id) return;
    if (!isTypingRef.current && value.trim()) {
      isTypingRef.current = true;
      emitTyping(sel.id, true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (isTypingRef.current) {
        isTypingRef.current = false;
        emitTyping(sel.id, false);
      }
    }, 2000);
  };

  const typingLabel = () => {
    if (!typingUsers.length) return null;
    if (sel.type === "dm") return `${typingUsers[0].username} is typing...`;
    if (typingUsers.length === 1) return `${typingUsers[0].username} is typing...`;
    return "Several users are typing...";
  };

  const nowTime = () => new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
  const closeAll = () => { setEmojiOpen(false); setHeaderMenu(false); setCtxMenu(null); };

  const askConfirm = (title:string, body:string, onOk:()=>void) => setConfirm({ title, body, onOk });

  const send = async (extra?: Partial<ChatMsg>) => {
    const trimmed = input.trim();
    if (!trimmed && !extra?.mediaUrl) return;
    const replySnap = replyingTo;
    setInput(""); setReplyingTo(null); setEmojiOpen(false);
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.style.height = "auto";
      }
    });
    if (isTypingRef.current) { isTypingRef.current = false; emitTyping(sel.id, false); }
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    try {
      const { message } = await api.messages.send(sel.id, trimmed, replySnap?.id);
      appendLocal(toChatMsg(message, currentUserId));
      refreshContacts();
    } catch {
      appendLocal({
        id: Date.now(), user: "You", msg: trimmed, time: nowTime(), self: true,
        ...(replySnap ? { replyTo: { id: replySnap.id, user: replySnap.user, preview: replySnap.msg.slice(0,60) || replySnap.mediaType || "" } } : {}),
        ...extra,
      });
    }
    requestAnimationFrame(() => forceScrollToBottom("auto"));
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const replySnap = replyingTo;
    setReplyingTo(null); e.target.value = "";
    pinToBottomRef.current = true;
    isNearBottomRef.current = true;
    try {
      const { message } = await api.messages.sendMedia(sel.id, file, replySnap?.id);
      appendLocal(toChatMsg(message, currentUserId));
      refreshContacts();
    } catch {
      const url = URL.createObjectURL(file);
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      const isAudio = file.type.startsWith("audio/");
      const type = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file";
      appendLocal({
        id:Date.now(), user:"You", msg:"", time:nowTime(), self:true,
        mediaUrl:url, mediaType:type, fileName:file.name, fileSize:file.size,
      });
    }
    requestAnimationFrame(() => forceScrollToBottom("auto"));
  };

  const commitEdit = async (id: number) => {
    if (!editText.trim()) return;
    try {
      const { message } = await api.messages.edit(id, editText.trim());
      updateLocal(id, toChatMsg(message, currentUserId));
    } catch {
      updateLocal(id, { msg: editText.trim(), edited: true });
    }
    setEditingId(null);
  };

  const deleteMsg = async (id: number) => {
    try { await api.messages.delete(id); } catch { /* */ }
    applyDeletedMessage(id);
  };

  const addReaction = async (msgId: number, emoji: string) => {
    try {
      const { reactions } = await api.messages.react(msgId, emoji);
      applyReaction(msgId, reactions);
    } catch {
      const m = msgsRef.current.find(x => x.id === msgId);
      if (!m) return;
      const r = { ...(m.reactions || {}) };
      const users = r[emoji] ? [...r[emoji]] : [];
      const me = String(currentUserId);
      if (users.includes(me) || users.includes("You")) {
        const f = users.filter(u => u !== me && u !== "You");
        if (f.length === 0) delete r[emoji];
        else r[emoji] = f;
      } else {
        r[emoji] = [...users, me];
      }
      applyReaction(msgId, r);
    }
  };

  const deleteContact = async (contactId: number) => {
    try { await api.messages.deleteContact(contactId); } catch { /* */ }
    setContacts(prev => prev.filter(c => c.id !== contactId));
    if (sel.id === contactId) { const remaining = contacts.filter(c=>c.id!==contactId); if(remaining.length) setSel(remaining[0]); }
    refreshContacts();
  };

  const scrollTo = (id: number) => {
    const el = msgRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.animate([{ boxShadow: "0 0 0 3px " + C.primary + "66" }, { boxShadow: "0 0 0 0px transparent" }], { duration: 800 });
      return;
    }
    const dataIndex = msgsRef.current.findIndex(m => m.id === id);
    if (dataIndex >= 0) {
      virtuosoRef.current?.scrollToIndex({
        index: firstItemIndexRef.current + dataIndex,
        align: "center",
        behavior: "smooth",
      });
    }
  };

  const filteredContacts = contacts.filter(c => {
    if (listFilter === "dm-requests") return false;
    if (listFilter !== "all" && c.type !== listFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.msg.toLowerCase().includes(q);
    }
    return true;
  });

  const sendDmRequest = async () => {
    const username = newDmUsername.trim();
    if (!username) { setNewDmError("Please enter a username"); return; }
    setNewDmLoading(true);
    setNewDmError("");
    try {
      const result = await api.dm.createRequest(username);
      if (result.conversationId) {
        const convs = await api.messages.conversations();
        setContacts(convs.conversations as Contact[]);
        const conv = convs.conversations.find(c => c.id === result.conversationId);
        if (conv) setSel(conv as Contact);
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Conversation opened");
      } else {
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Direct message request sent");
      }
    } catch (e) {
      if (e instanceof ApiError && e.data?.conversationId != null) {
        const convId = Number(e.data.conversationId);
        const convs = await api.messages.conversations();
        setContacts(convs.conversations as Contact[]);
        const conv = convs.conversations.find(c => c.id === convId);
        if (conv) setSel(conv as Contact);
        setNewDmOpen(false);
        setNewDmUsername("");
        toast.success("Conversation opened");
      } else {
        setNewDmError(e instanceof Error ? e.message : "Could not send request");
      }
    } finally {
      setNewDmLoading(false);
    }
  };

  const acceptDmRequest = async (requestId: number) => {
    try {
      const { conversationId } = await api.dm.accept(requestId);
      loadDmRequests();
      joinConversation(conversationId);
      const convs = await api.messages.conversations();
      setContacts(convs.conversations as Contact[]);
      const conv = convs.conversations.find(c => c.id === conversationId);
      if (conv) {
        setSel(conv as Contact);
        setListFilter("dm");
      }
      toast.success("Request accepted");
    } catch {
      toast.error("Could not accept request");
    }
  };

  const rejectDmRequest = async (requestId: number) => {
    try {
      await api.dm.reject(requestId);
      loadDmRequests();
      toast.success("Request declined");
    } catch {
      toast.error("Could not decline request");
    }
  };

  const sidebarFilters: { id: ListFilter; Icon: typeof TagIcon; l: string; badge?: number }[] = [
    { Icon: TagIcon, l: "All", id: "all" },
    { Icon: GroupsIcon, l: "Channels", id: "channel" },
    { Icon: ChatBubbleIcon, l: "DMs", id: "dm" },
    ...(dmRequests.length > 0 ? [{ Icon: InboxIcon, l: "DM Requests", id: "dm-requests" as const, badge: dmRequests.length }] : []),
  ];

  const makeMenuItems = (contact: Contact, closeFn: ()=>void) => {
    if (contact.type === "channel") {
      return [
        { Icon:VolumeOffIcon, label: contact.muted ? "Unmute Notifications" : "Mute Notifications", danger:false, action:() => {
          api.messages.mute(contact.id).then(r => {
            setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, muted: r.muted } : c));
            setSel(prev => prev.id === contact.id ? { ...prev, muted: r.muted } : prev);
          }).catch(() => {});
          closeFn();
        } },
      ];
    }
    return [
      { Icon:VolumeOffIcon, label: contact.muted ? "Unmute Notifications" : "Mute Notifications", danger:false, action:() => {
        api.messages.mute(contact.id).then(r => {
          setContacts(prev => prev.map(c => c.id === contact.id ? { ...c, muted: r.muted } : c));
          setSel(prev => prev.id === contact.id ? { ...prev, muted: r.muted } : prev);
        }).catch(() => {});
        closeFn();
      } },
      { Icon:BlockIcon,     label:"Block User",          danger:true,  action:() => { askConfirm("Block User", `Block ${contact.name}? They won't be able to message you.`, () => { if (contact.otherUserId) api.users.block(contact.otherUserId).catch(() => {}); closeFn(); }); } },
      { Icon:FlagIcon,      label:"Report User",         danger:true,  action:() => { askConfirm("Report User", `Report ${contact.name} for inappropriate behaviour?`, () => { api.messages.report({ reason: `Reported user: ${contact.name}`, userId: contact.otherUserId }).catch(() => {}); closeFn(); }); } },
      { Icon:PersonIcon,    label:"Delete Contact",      danger:true,  action:() => { askConfirm("Delete Contact", `Remove ${contact.name} from your contacts?`, () => { deleteContact(contact.id); closeFn(); }); } },
    ];
  };

  const DropdownMenu = ({ items, onClose }: { items: ReturnType<typeof makeMenuItems>; onClose: ()=>void }) => (
    <div className="py-1" onClick={e => e.stopPropagation()}>
      {items.map(item => (
        <button key={item.label} onClick={item.action} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-black/5 transition-colors" style={{ color:item.danger?C.error:C.onSurface, fontFamily:"Roboto" }}>
          <item.Icon style={{ fontSize:18 }} />{item.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="h-screen flex overflow-hidden pt-16 max-w-[100vw]" style={{ background:C.bg }} onClick={closeAll}>
      {/* New DM modal */}
      {newDmOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setNewDmOpen(false)}>
          <div className="rounded-3xl p-6 w-full max-w-sm shadow-2xl" style={{ background: C.surface }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-base" style={{ color: C.onSurface, fontFamily: "Roboto" }}>New Direct Message</h3>
              <button onClick={() => setNewDmOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color: C.onSurfaceVar }}><CloseIcon style={{ fontSize: 18 }} /></button>
            </div>
            <Field label="Username" value={newDmUsername} onChange={v => { setNewDmUsername(v); setNewDmError(""); }} placeholder="Enter exact username" />
            {newDmError && <p className="text-sm mt-2" style={{ color: C.error, fontFamily: "Roboto" }}>{newDmError}</p>}
            <div className="flex gap-3 justify-end mt-6">
              <OutlinedBtn onClick={() => setNewDmOpen(false)}>Cancel</OutlinedBtn>
              <FilledBtn onClick={sendDmRequest} cls={newDmLoading ? "opacity-60 pointer-events-none" : ""}>
                {newDmLoading ? "Sending…" : "Send Request"}
              </FilledBtn>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setConfirm(null)}>
          <div className="rounded-3xl p-6 w-full max-w-xs shadow-2xl" style={{ background:C.surface }} onClick={e => e.stopPropagation()}>
            <h3 className="font-medium text-base mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{confirm.title}</h3>
            <p className="text-sm mb-6" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{confirm.body}</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 rounded-full text-sm font-medium border transition-colors hover:bg-black/5" style={{ borderColor:C.outline, color:C.onSurface, fontFamily:"Roboto" }}>Cancel</button>
              <button onClick={() => { confirm.onOk(); setConfirm(null); }} className="px-4 py-2 rounded-full text-sm font-medium text-white transition-colors hover:opacity-90" style={{ background:C.error, fontFamily:"Roboto" }}>Confirm</button>
            </div>
          </div>
        </div>
      )}
      {/* Image lightbox */}
      {lightbox && <ImageLightbox src={lightbox} onClose={() => setLightbox(null)} />}
      {/* Right-click context menu */}
      {ctxMenu && (
        <div className="fixed z-50 rounded-2xl border shadow-xl overflow-hidden" style={{ top:ctxMenu.y, left:ctxMenu.x, background:C.surface, borderColor:C.outlineVar, minWidth:"13rem" }} onClick={e => e.stopPropagation()}>
          <DropdownMenu items={makeMenuItems(ctxMenu.contact, ()=>setCtxMenu(null))} onClose={()=>setCtxMenu(null)} />
        </div>
      )}
      {/* Settings Modal */}
      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4" onClick={() => setSettingsOpen(false)}>
          <div className="rounded-3xl p-6 w-full max-w-sm" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.24)" }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-medium text-base" style={{ color:C.onSurface, fontFamily:"Roboto" }}>My Profile</h3>
              <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color:C.onSurfaceVar }}><CloseIcon style={{ fontSize:18 }} /></button>
            </div>
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <ChatAvatar name={currentUser?.username || "?"} avatarUrl={currentUser?.avatarUrl} size={64} />
                <div className="w-4 h-4 rounded-full border-2 border-white absolute bottom-0 right-0" style={{ background:STATUS_COLORS[myStatus] || STATUS_COLORS.Online }} />
              </div>
              <div>
                <p className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>{currentUser?.username || "Shinobi"}</p>
                <p className="text-xs mt-0.5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>
                  {currentUser?.isTeamMember ? "Team Member" : currentUser?.isAdmin ? "Administrator" : "Member"}
                  {currentUser?.memberSince ? ` · since ${currentUser.memberSince}` : ""}
                </p>
              </div>
            </div>
            <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Status</p>
            <div className="flex flex-col gap-1.5 mb-5">
              {(["Online","Away","Do Not Disturb","Offline"] as const).map(s => {
                const checked = myStatus === s;
                return (
                  <label key={s} className="flex items-center gap-3 px-3 py-2.5 rounded-2xl border cursor-pointer transition-all" style={{ borderColor:checked?STATUS_COLORS[s]:C.outlineVar, background:checked?`${STATUS_COLORS[s]}18`:"transparent" }}>
                    <input type="radio" name="status" value={s} checked={checked} onChange={() => setMyStatus(s)} className="sr-only" />
                    <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-all" style={{ borderColor:STATUS_COLORS[s], background:checked?STATUS_COLORS[s]:"transparent" }}>
                      {checked && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </span>
                    <span className="flex items-center gap-2 text-xs font-medium" style={{ color:checked?STATUS_COLORS[s]:C.onSurfaceVar, fontFamily:"Roboto" }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background:STATUS_COLORS[s] }} />{s}
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs font-medium mb-2 uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Bio</p>
            <textarea rows={3} value={myBio} onChange={e => setMyBio(e.target.value)} className="w-full px-4 py-3 rounded-2xl border text-sm focus:outline-none resize-none mb-5" style={{ borderColor:C.outline, color:C.onSurface, background:C.surfaceVar, fontFamily:"Roboto" }} />
            <FilledBtn cls={`w-full justify-center ${savingProfile ? "opacity-60 pointer-events-none" : ""}`} onClick={saveMyProfile}><CheckIcon style={{ fontSize:16 }} />{savingProfile ? "Saving…" : "Save"}</FilledBtn>
          </div>
        </div>
      )}
      {/* Left chrome: filter rail + conversation list (mobile: exactly 100vw, no overflow) */}
      {showLeftPanel && (
        <div
          className={isMobile
            ? "grid grid-cols-[72px_minmax(0,1fr)] w-full max-w-full min-w-0 min-h-0 flex-1 overflow-hidden"
            : "flex shrink-0 min-h-0"}
        >
          <div className="w-[72px] border-r flex flex-col items-center py-4 gap-2 shrink-0 min-w-[72px] max-w-[72px]" style={{ background:C.surfaceVar, borderColor:C.outlineVar }}>
            {sidebarFilters.map(({ Icon, l, id, badge }) => {
              const active = listFilter === id;
              return (
                <button key={l} title={l} onClick={() => setListFilter(id)} aria-pressed={active}
                  className="relative w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 focus:outline-none focus-visible:ring-2"
                  style={{
                    background: active ? C.primaryCont : C.surface,
                    color: active ? C.primary : C.onSurfaceVar,
                    boxShadow: active ? `0 0 0 2px ${C.primary}` : SH1,
                  }}>
                  <Icon style={{ fontSize:20 }} />
                  {badge != null && badge > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full text-white text-[9px] flex items-center justify-center font-bold" style={{ background: BADGE_BG }}>{badge}</span>
                  )}
                </button>
              );
            })}
            <button title="Settings" onClick={e => { e.stopPropagation(); setSettingsOpen(true); }} className="w-12 h-12 rounded-full flex items-center justify-center transition-all hover:scale-110 mt-auto" style={{ background:C.surface, color:C.onSurfaceVar, boxShadow:SH1 }}>
              <SettingsIcon style={{ fontSize:20 }} />
            </button>
          </div>
          {showConversationList && (
            <div
              className={isMobile
                ? "border-r flex flex-col min-h-0 min-w-0 overflow-hidden"
                : "w-72 border-r flex flex-col shrink-0 min-h-0"}
              style={{ background:C.surface, borderColor:C.outlineVar, boxShadow:SH1 }}
            >
              <div className="p-4 border-b" style={{ borderColor:C.outlineVar }}>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-full border flex-1" style={{ background:C.surfaceVar, borderColor:C.outlineVar }}>
                    <SearchIcon style={{ fontSize:18, color:C.onSurfaceVar }} />
                    <input placeholder="Search messages..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto" }} />
                  </div>
                  <button title="New Direct Message" onClick={e => { e.stopPropagation(); setNewDmOpen(true); setNewDmError(""); setNewDmUsername(""); }}
                    className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2"
                    style={{ background: C.primaryCont, color: C.primary, boxShadow: SH1 }}>
                    <PersonAddIcon style={{ fontSize: 20 }} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-2 ninja-scroll" onScroll={onScrollReveal}>
                {listFilter === "dm-requests" ? (
                  <div className="px-4">
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Pending Requests</span>
                    </div>
                    <div className="space-y-2">
                      {dmRequests.length === 0 ? (
                        <p className="text-xs px-2 py-6 text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No pending requests.</p>
                      ) : dmRequests.map(req => (
                        <div key={req.id} className="flex items-center gap-3 p-2.5 rounded-2xl" style={{ background: C.surfaceVar }}>
                          <ChatAvatar name={req.requesterName} avatarUrl={req.requesterAvatar} size={36} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{req.requesterDisplayName || req.requesterName}</p>
                            <p className="text-[10px] truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>@{req.requesterName}</p>
                            <p className="text-[10px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono,monospace" }}>{req.time}</p>
                          </div>
                          <div className="flex flex-col gap-1 shrink-0">
                            <button onClick={() => acceptDmRequest(req.id)} className="px-2.5 py-1 rounded-full text-[10px] font-medium text-white" style={{ background: C.primary, fontFamily: "Roboto" }}>Accept</button>
                            <button onClick={() => rejectDmRequest(req.id)} className="px-2.5 py-1 rounded-full text-[10px] font-medium border" style={{ borderColor: C.outline, color: C.error, fontFamily: "Roboto" }}>Reject</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                <>
                {(["channel","dm"] as const).map(section => {
                  const items = filteredContacts.filter(c => c.type === section);
                  if (!items.length) return null;
                  return (
                    <div key={section}>
                      <div className="px-4 pt-3 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{section === "channel" ? "Channels" : "Direct Messages"}</span>
                      </div>
                      {items.map(m => (
                        <button key={m.id} onClick={() => selectConversation(m)}
                          onContextMenu={e => { e.preventDefault(); setCtxMenu({ x:e.clientX, y:e.clientY, contact:m }); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[#6750A4]/6" style={{ background:sel.id===m.id?C.primaryCont:"transparent" }}>
                          <div className="relative shrink-0">
                            {m.type === "channel" ? (
                              <ChatAvatar name={m.name} size={40} channel />
                            ) : (
                              <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={40} />
                            )}
                            {m.type === "dm" && <FiberManualRecordIcon style={{ fontSize:12, color:presenceColor(m), position:"absolute", bottom:-1, right:-1 }} />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex justify-between items-center gap-2">
                              <span className="text-sm font-medium truncate" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{m.name}</span>
                              {m.muted && <VolumeOffIcon style={{ fontSize:14, color:C.onSurfaceVar }} titleAccess="Muted" />}
                            </div>
                            {m.type === "dm" && (
                              <p className="text-xs truncate" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{m.msg}</p>
                            )}
                          </div>
                          {m.type === "dm" && (
                            <div className="w-5 h-5 shrink-0 flex items-center justify-center">
                              {m.unread > 0 && (
                                <div className="unread-badge rounded-full flex items-center justify-center text-white text-[10px] font-bold" style={{ background:BADGE_BG }}>{m.unread > 9 ? "9+" : m.unread}</div>
                              )}
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  );
                })}
                </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {/* Chat */}
      {showChatPane && (
      <div className="flex-1 flex flex-col min-w-0 relative">
        {listFilter === "dm-requests" ? (
          <div className="flex-1 flex items-center justify-center px-6" style={{ background: C.surfaceVar }}>
            <div className="text-center max-w-sm">
              <InboxIcon style={{ fontSize: 48, color: C.onSurfaceVar, marginBottom: 16 }} />
              <p className="font-medium text-sm mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Direct Message Requests</p>
              <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Select a request from the list to accept or decline.</p>
            </div>
          </div>
        ) : (
        <>
        {/* Chat header */}
        <div className="flex items-center gap-3 px-5 py-3 border-b shrink-0 relative" style={{ background:C.surface, borderColor:C.outlineVar, boxShadow:SH1 }}>
          <button title={showSidebar?"Hide sidebar":"Show sidebar"} onClick={e => { e.stopPropagation(); setShowSidebar(!showSidebar); }} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5 shrink-0" style={{ color:C.onSurfaceVar }}>
            <MenuIcon style={{ fontSize:20 }} />
          </button>
          <button
            type="button"
            className="relative shrink-0 rounded-full focus:outline-none focus-visible:ring-2"
            onClick={e => { e.stopPropagation(); openConversationDetails(); }}
            aria-label={isMobile ? `View ${sel.type === "channel" ? "channel" : "user"} details` : undefined}
            style={{ cursor: isMobile && sel.id > 0 ? "pointer" : "default" }}
            tabIndex={isMobile && sel.id > 0 ? 0 : -1}
          >
            {sel.type === "channel" ? (
              <ChatAvatar name={sel.name} size={36} channel />
            ) : (
              <ChatAvatar name={sel.name} avatarUrl={sel.avatarUrl} size={36} />
            )}
            {sel.type === "dm" && <FiberManualRecordIcon style={{ fontSize:10, color:presenceColor(sel), position:"absolute", bottom:-1, right:-1 }} />}
          </button>
          <div>
            <p className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{sel.name}</p>
            <p className="text-xs" style={{ color: sel.type==="channel" ? C.onSurfaceVar : presenceColor(sel), fontFamily:"Roboto" }}>{presenceLabel(sel)}</p>
          </div>
          <div className="ml-auto relative">
            <button onClick={e => { e.stopPropagation(); setHeaderMenu(o => !o); }} className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5" style={{ color:C.onSurfaceVar }}><MoreVertIcon style={{ fontSize:20 }} /></button>
            {headerMenu && (
              <div className="absolute right-0 top-full mt-1 w-52 rounded-2xl border shadow-xl z-50 overflow-hidden" style={{ background:C.surface, borderColor:C.outlineVar }}>
                <DropdownMenu items={makeMenuItems(sel, ()=>setHeaderMenu(false))} onClose={()=>setHeaderMenu(false)} />
              </div>
            )}
          </div>
        </div>
        {/* Message list */}
        <div className="flex-1 relative min-h-0 min-w-0 flex flex-col overflow-hidden" style={{ background:C.surfaceVar }} onClick={closeAll}>
          {threadReady && msgs.length > 0 ? (
            <Virtuoso
              key={`${sel.id}-${threadBootId}`}
              ref={virtuosoRef}
              className="flex-1 px-5 min-w-0"
              style={{ height: "100%", overflowX: "hidden" }}
              data={msgs}
              firstItemIndex={firstItemIndex}
              initialTopMostItemIndex={initialScrollIndex ?? msgs.length - 1}
              increaseViewportBy={{ top: 600, bottom: 600 }}
              defaultItemHeight={72}
              followOutput={() => (pinToBottomRef.current ? "auto" : false)}
              startReached={() => { void loadOlderMessages(); }}
              endReached={() => { void loadNewerMessages(); }}
              atBottomStateChange={(atBottom) => {
                isNearBottomRef.current = atBottom;
                pinToBottomRef.current = atBottom;
                setShowJumpBtn(!atBottom && sel.id > 0);
                if (atBottom) {
                  setUnreadBelow(0);
                  if (sel.id && msgsRef.current.length && !hasMoreNewer) {
                    const newest = msgsRef.current[msgsRef.current.length - 1].id;
                    setLastReadMessageId(newest);
                    scheduleMarkRead(sel.id);
                  }
                }
              }}
              scrollerRef={(ref) => {
                if (ref instanceof HTMLElement) {
                  ref.classList.add("ninja-scroll");
                  if (!ref.dataset.scrollBound) {
                    ref.dataset.scrollBound = "1";
                    ref.addEventListener("scroll", () => {
                      ref.classList.add("is-scrolling");
                      if (virtuosoScrollTimer.current) clearTimeout(virtuosoScrollTimer.current);
                      virtuosoScrollTimer.current = setTimeout(() => ref.classList.remove("is-scrolling"), 900);
                    }, { passive: true });
                  }
                }
              }}
              rangeChanged={(range) => {
                visibleStartDataIndexRef.current = Math.max(0, range.startIndex - firstItemIndexRef.current);
                msgPerf.renderedRows(range.endIndex - range.startIndex + 1);
              }}
              components={{
                Header: () => (
                  <div className="flex flex-col items-center justify-center min-h-[28px] py-3 gap-1">
                    {loadingOlder ? (
                      <CircularProgress size={18} thickness={4} style={{ color: C.primary }} />
                    ) : !hasMoreOlder ? (
                      <span className="text-[11px]" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Beginning of conversation</span>
                    ) : (
                      <span className="text-[11px] opacity-50" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Scroll for older messages</span>
                    )}
                  </div>
                ),
                Footer: () => (
                  <div className="pb-3">
                    {loadingNewer && (
                      <div className="flex justify-center py-2">
                        <CircularProgress size={16} thickness={4} style={{ color: C.primary }} />
                      </div>
                    )}
                    {typingLabel() && (
                      <p className="text-xs px-2 py-1 italic" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{typingLabel()}</p>
                    )}
                  </div>
                ),
              }}
              itemContent={(absoluteIndex, m) => {
                const dataIndex = absoluteIndex - firstItemIndex;
                const prev = dataIndex > 0 ? msgs[dataIndex - 1] : undefined;
                return (
                  <MessageRow
                    m={m}
                    prev={prev}
                    lastReadMessageId={lastReadMessageId}
                    currentUserId={currentUserId}
                    isMobile={isMobile}
                    C={C}
                    editingId={editingId}
                    editText={editingId === m.id ? editText : ""}
                    setEditText={setEditText}
                    setEditingId={setEditingId}
                    registerRef={(id, el) => {
                      if (el) msgRefs.current.set(id, el);
                      else msgRefs.current.delete(id);
                    }}
                    onScrollTo={scrollTo}
                    onLightbox={setLightbox}
                    onReply={setReplyingTo}
                    onReact={addReaction}
                    onDelete={(id) => askConfirm("Delete Message", "Delete this message permanently?", () => deleteMsg(id))}
                    onReport={(id) => askConfirm("Report Message", "Report this message for inappropriate content?", () => { api.messages.report({ messageId: id }).catch(() => {}); })}
                    onCommitEdit={commitEdit}
                    onOpenProfile={openUserProfileFromMessage}
                  />
                );
              }}
            />
          ) : threadReady ? (
            <div className="flex-1 flex items-center justify-center px-6">
              <p className="text-sm text-center" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                {sel.id > 0 ? "No messages yet — say hello!" : "Select a conversation"}
              </p>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <CircularProgress size={28} thickness={4} style={{ color: C.primary }} />
            </div>
          )}
          {showJumpBtn && sel.id > 0 && (
            <div
              className="absolute z-20 transition-all duration-200 ease-out animate-in fade-in zoom-in-95"
              style={{ right: 28, bottom: 28 }}
            >
              <Badge
                badgeContent={unreadBelow > 0 ? (unreadBelow > 99 ? "99+" : unreadBelow) : 0}
                color="error"
                overlap="circular"
                invisible={unreadBelow <= 0}
              >
                <button
                  type="button"
                  onClick={async () => {
                    await jumpToLatest();
                    forceScrollToBottom("smooth");
                    if (sel?.id) {
                      scheduleMarkRead(sel.id);
                      if (msgsRef.current.length) setLastReadMessageId(msgsRef.current[msgsRef.current.length - 1].id);
                    }
                  }}
                  className="w-12 h-12 rounded-full flex items-center justify-center hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 transition-transform hover:scale-105"
                  style={{
                    background: C.bg === "#FFFBFE" ? "#1C1B1F" : "#FFFFFF",
                    color: C.bg === "#FFFBFE" ? "#FFFFFF" : "#1C1B1F",
                    boxShadow: SH1,
                  }}
                  aria-label="Jump to latest message"
                  title="Jump to latest"
                >
                  <KeyboardArrowDownIcon style={{ fontSize: 26, color: "inherit" }} />
                </button>
              </Badge>
            </div>
          )}
        </div>
        {/* Input bar */}
        <div className="border-t shrink-0" style={{ background:C.surface, borderColor:C.outlineVar }}>
          {replyingTo && (
            <div className="flex items-center gap-3 px-5 py-2 border-b" style={{ borderColor:C.outlineVar, background:C.surfaceVar }}>
              <ReplyIcon style={{ fontSize:16, color:C.primary }} />
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium" style={{ color:C.primary, fontFamily:"Roboto" }}>Replying to {replyingTo.user}</span>
                <p className="text-xs truncate" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{replyingTo.msg || "📎 Attachment"}</p>
              </div>
              <button onClick={() => setReplyingTo(null)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-black/8" style={{ color:C.onSurfaceVar }}><CloseIcon style={{ fontSize:14 }} /></button>
            </div>
          )}
          <div className="px-5 py-3 relative">
            {emojiOpen && (
              <div ref={emojiPickerRef} className="fixed w-80 rounded-2xl shadow-2xl border overflow-hidden z-40" style={{ background:C.surface, borderColor:C.outlineVar, right: emojiPickerPos.right, bottom: emojiPickerPos.bottom, maxWidth: "calc(100vw - 16px)" }} onClick={e => e.stopPropagation()}>
                <div className="flex border-b" style={{ borderColor:C.outlineVar }}>
                  {(["emoji","gif"] as const).map(t => (
                    <button key={t} onClick={() => setEmojiTab(t)} className="flex-1 py-2.5 text-xs font-medium uppercase tracking-widest transition-colors" style={{ color:emojiTab===t?C.primary:C.onSurfaceVar, borderBottom:emojiTab===t?`2px solid ${C.primary}`:"2px solid transparent", fontFamily:"Roboto", background:"transparent" }}>
                      {t === "emoji" ? "😀 Emoji" : "GIF"}
                    </button>
                  ))}
                </div>
                {emojiTab === "emoji" ? (
                  <div className="p-3 grid grid-cols-8 gap-1 max-h-52 overflow-y-auto ninja-scroll" onScroll={onScrollReveal}>
                    {EMOJI_LIST.map(e => <button key={e} onClick={() => { setInput(i => i + e); requestAnimationFrame(adjustComposerHeight); }} className="text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:scale-125 transition-transform">{e}</button>)}
                  </div>
                ) : (
                  <div className="p-3 grid grid-cols-2 gap-2 max-h-52 overflow-y-auto ninja-scroll" onScroll={onScrollReveal}>
                    {GIF_LIST.map(g => (
                      <button key={g.label} onClick={() => { appendLocal({ id:Date.now(), user:"You", msg:"", time:nowTime(), self:true, mediaUrl:g.url, mediaType:"gif" }); setEmojiOpen(false); pinToBottomRef.current = true; requestAnimationFrame(() => forceScrollToBottom("auto")); }} className="rounded-xl overflow-hidden border hover:opacity-80 transition-opacity" style={{ borderColor:C.outlineVar }}>
                        <img src={g.url} alt={g.label} className="w-full h-16 object-cover" />
                        <p className="text-[10px] py-1 text-center" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{g.label}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" className="hidden" onChange={handleFile} />
            <div
              className="flex items-center gap-2 rounded-[24px] border px-4 py-2.5 cursor-text"
              style={{ borderColor:C.outlineVar }}
              onMouseDown={e => {
                const target = e.target as HTMLElement;
                if (target.closest("button") || target.closest("a") || target.tagName === "TEXTAREA") return;
                if (settingsOpen || newDmOpen || confirm || emojiOpen) return;
                e.preventDefault();
                inputRef.current?.focus();
              }}
            >
              <button type="button" className="shrink-0 self-center" onClick={() => fileRef.current?.click()} style={{ color:C.onSurfaceVar }} title="Attach any file"><AttachFileIcon style={{ fontSize:20 }} /></button>
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={e => { handleInputChange(e.target.value); requestAnimationFrame(adjustComposerHeight); }}
                onKeyDown={e => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={`Message ${sel.name}...`}
                className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none resize-none leading-5 py-0.5"
                style={{ color:C.onSurface, fontFamily:"Roboto", maxHeight: COMPOSER_MAX_HEIGHT, overflowY: "auto" }}
                onClick={() => setEmojiOpen(false)}
              />
              <button type="button" ref={emojiBtnRef} className="shrink-0 self-center" onClick={e => { e.stopPropagation(); setEmojiOpen(o => !o); }} style={{ color:emojiOpen?C.primary:C.onSurfaceVar }} title="Emoji / GIF"><EmojiEmotionsIcon style={{ fontSize:20 }} /></button>
              <button type="button" onClick={() => send()} className="w-8 h-8 rounded-full flex items-center justify-center ml-1 text-white hover:opacity-90 shrink-0 self-center" style={{ background:C.primary }}><SendIcon style={{ fontSize:16 }} /></button>
            </div>
          </div>
        </div>
        </>
        )}
      </div>
      )}
      {/* Right panel — desktop/tablet lg+ */}
      {listFilter !== "dm-requests" && sel.id > 0 && (
      <div className="hidden lg:flex w-72 border-l flex-col p-5 shrink-0 overflow-y-auto ninja-scroll" style={{ background:C.surface, borderColor:C.outlineVar }} onScroll={onScrollReveal}>
        <ConversationDetailsBody sel={sel} C={C} presenceColor={presenceColor} presenceLabel={presenceLabel} />
      </div>
      )}
      {/* Mobile conversation / user details modal */}
      {detailsOpen && isMobile && detailsContact && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={detailsContact.type === "channel" ? "Channel details" : "User profile"}
          onClick={dismissConversationDetails}
        >
          <div
            className="w-full sm:max-w-sm max-h-[85vh] overflow-y-auto ninja-scroll rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl"
            style={{ background: C.surface }}
            onClick={e => e.stopPropagation()}
            onScroll={onScrollReveal}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-base" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                {detailsContact.type === "channel" ? "Channel Info" : "Profile"}
              </h3>
              <button
                type="button"
                onClick={dismissConversationDetails}
                className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-black/5"
                style={{ color: C.onSurfaceVar }}
                aria-label="Close details"
              >
                <CloseIcon style={{ fontSize: 18 }} />
              </button>
            </div>
            <ConversationDetailsBody sel={detailsContact} C={C} presenceColor={presenceColor} presenceLabel={presenceLabel} />
          </div>
        </div>
      )}
    </div>
  );
}

export default MessagesPage;
