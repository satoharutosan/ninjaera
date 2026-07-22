import type { ReactNode } from "react";
import { ColorTheme, SH1 } from "@/app/shared";
import { desktopDarkSelfBubble } from "@/shared/desktopMessageTheme";
import { LazyVisible } from "../LazyVisible";
import { MediaPreviewLine } from "../MediaPreviewLine";
import { VoiceMessagePlayer } from "../VoiceMessagePlayer";
import { getStandaloneEmojis, jumboEmojiFontSize } from "../emojiOnly";
import { URL_SPLIT } from "../constants";
import type { ChatMsg } from "../types";
import { TextWithLinks, LinkPreviewCard } from "./TextWithLinks";
import { VideoPlayer } from "./VideoPlayer";
import { FileBubble } from "./FileBubble";

/** Fixed display boxes — reserve space before decode so Virtuoso height stays stable. */
const IMAGE_BOX = { maxWidth: 420, height: 280 } as const;
const VIDEO_BOX = { maxWidth: 320, height: 200 } as const;
const GIF_BOX = { maxWidth: 320, height: 180 } as const;

function MediaReserveBox({
  maxWidth,
  height,
  children,
  onClick,
  className = "",
}: {
  maxWidth: number;
  height: number;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl ${className}`}
      style={{
        width: `min(100%, ${maxWidth}px)`,
        height,
        maxWidth,
        boxShadow: SH1,
        background: "rgba(0,0,0,.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function MediaBubble({ msg, self, C, onScrollTo, onLightbox }: { msg: ChatMsg; self: boolean; C: ColorTheme; onScrollTo?: (id: number) => void; onLightbox?: (url: string) => void }) {
  const desktopSelf = self ? desktopDarkSelfBubble(C) : null;
  const bg = self ? (desktopSelf?.bg ?? C.primary) : C.surface;
  const fg = self
    ? (desktopSelf?.fg ?? (C.bg === "#FFFBFE" ? "white" : C.onPrimary))
    : C.onSurface;
  const corner = self ? "rounded-[20px_4px_20px_20px]" : "rounded-[4px_20px_20px_20px]";
  const hasLink = URL_SPLIT.test(msg.msg); URL_SPLIT.lastIndex = 0;
  const isLight = C.bg === "#FFFBFE";
  // Desktop dark self bubbles are light-white — use light reply chrome, not white-on-accent.
  const replyUsesSelfStyle = self && !isLight && !desktopSelf;
  const replyPreviewColor = replyUsesSelfStyle ? "white" : C.onSurfaceVar;
  const replyBlock = msg.replyTo ? (
    <button onClick={() => onScrollTo?.(msg.replyTo!.id)} className={`w-full min-w-0 max-w-full text-left px-3 py-1.5 mb-1 rounded-xl border-l-4 text-xs cursor-pointer hover:opacity-80 transition-opacity ${replyUsesSelfStyle ? "rounded-[16px_4px_4px_16px]" : "rounded-[4px_16px_16px_4px]"}`} style={{ background: replyUsesSelfStyle ? "rgba(255,255,255,.15)" : C.surfaceVar, borderColor: replyUsesSelfStyle ? "rgba(255,255,255,.5)" : C.primary }}>
      <span className="font-medium block truncate" style={{ color: replyUsesSelfStyle ? "rgba(255,255,255,.9)" : C.primary, fontFamily:"Roboto" }}>{msg.replyTo.user}</span>
      <span className="truncate block" style={{ color: replyPreviewColor, fontFamily:"Roboto", opacity: replyUsesSelfStyle ? 0.8 : 1 }}>
        <MediaPreviewLine text={msg.replyTo.preview || "Attachment"} color={replyPreviewColor} iconSize={12} />
      </span>
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
  if (msg.mediaType === "image") {
    const captionExtra = msg.msg ? 40 : 0;
    return shell(
    <LazyVisible placeholderHeight={IMAGE_BOX.height + captionExtra}>
      <div style={{ width: "fit-content", maxWidth: "100%" }}>
        <MediaReserveBox
          maxWidth={IMAGE_BOX.maxWidth}
          height={IMAGE_BOX.height}
          className="cursor-zoom-in"
          onClick={() => msg.mediaUrl && onLightbox?.(msg.mediaUrl)}
        >
          <img
            src={msg.mediaUrl}
            alt=""
            className="block hover:brightness-90 transition-[filter]"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              verticalAlign: "middle",
            }}
            decoding="async"
            loading="lazy"
          />
        </MediaReserveBox>
        {msg.msg && (
          <div className="px-3 py-1.5 text-sm min-w-0 text-left rounded-b-2xl" style={{ background: bg, color: fg, fontFamily: "Roboto", maxWidth: IMAGE_BOX.maxWidth }}>
            <TextWithLinks text={msg.msg} fg={fg} />
          </div>
        )}
      </div>
    </LazyVisible>
  );
  }
  if (msg.mediaType === "video") {
    const captionExtra = msg.msg ? 40 : 0;
    return shell(
    <LazyVisible placeholderHeight={VIDEO_BOX.height + captionExtra}>
      <div style={{ width: "fit-content", maxWidth: "100%" }}>
        <VideoPlayer src={msg.mediaUrl} reservedHeight={VIDEO_BOX.height} reservedMaxWidth={VIDEO_BOX.maxWidth} />
        {msg.msg && (
          <div className="px-3 py-1.5 text-sm rounded-b-2xl max-w-[min(320px,100%)] min-w-0" style={{ background:bg, color:fg, fontFamily:"Roboto" }}>
            <TextWithLinks text={msg.msg} fg={fg} />
          </div>
        )}
      </div>
    </LazyVisible>
  );
  }
  if (msg.mediaType === "audio") return shell(
    <LazyVisible placeholderHeight={72}>
      <div>
        <VoiceMessagePlayer
          src={msg.mediaUrl!}
          self={self}
          fileName={msg.fileName}
          durationMs={msg.durationMs}
          waveform={msg.waveform}
          mimeType={msg.mimeType}
        />
        {msg.msg && <div className="px-3 py-1.5 text-sm min-w-0 mt-1 rounded-2xl" style={{ background:bg, color:fg, fontFamily:"Roboto" }}><TextWithLinks text={msg.msg} fg={fg} /></div>}
      </div>
    </LazyVisible>
  );
  if (msg.mediaType === "gif") return shell(
    <LazyVisible placeholderHeight={GIF_BOX.height}>
      <MediaReserveBox maxWidth={GIF_BOX.maxWidth} height={GIF_BOX.height}>
        <img
          src={msg.mediaUrl}
          alt="gif"
          className="block"
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
          loading="lazy"
          decoding="async"
        />
      </MediaReserveBox>
    </LazyVisible>
  );
  if (!msg.msg) return null;

  // Discord-style jumbo emoji: emoji-only text (≤3), no bubble chrome
  if (!msg.mediaType && !hasLink) {
    const standalone = getStandaloneEmojis(msg.msg);
    const jumboSize = standalone ? jumboEmojiFontSize(standalone.length) : null;
    if (standalone && jumboSize) {
      return shell(
        <div
          className="leading-none select-text"
          style={{ fontSize: jumboSize, lineHeight: 1.15 }}
          aria-label={standalone.join(" ")}
        >
          {standalone.map((em, i) => (
            <span key={`${em}-${i}`} className="inline-block" style={{ marginInlineEnd: i < standalone.length - 1 ? 4 : 0 }}>
              {em}
            </span>
          ))}
          {msg.edited && <span className="text-[9px] opacity-60 ml-1 align-middle" style={{ fontSize: 10 }}>(edited)</span>}
        </div>
      );
    }
  }

  return shell(
    <div className={`px-4 py-2.5 text-sm min-w-0 max-w-full ${corner}`} style={{ background:bg, color:fg, fontFamily:"Roboto", boxShadow:SH1 }}>
      <TextWithLinks text={msg.msg} fg={fg} />
      {msg.edited && <span className="text-[9px] opacity-60 ml-1">(edited)</span>}
      {hasLink && <LinkPreviewCard text={msg.msg} self={self && !desktopSelf} C={C} />}
    </div>
  );
}
