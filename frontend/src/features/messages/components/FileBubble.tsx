import { useState } from "react";
import DownloadIcon from "@mui/icons-material/Download";
import { ColorTheme, SH1 } from "@/app/shared";
import { desktopDarkSelfBubble } from "@/shared/desktopMessageTheme";
import { fileTypeIcon } from "../mediaIcons";
import { formatBytes } from "../utils/formatBytes";
import type { ChatMsg } from "../types";

export function FileBubble({ msg, self, C }: { msg: ChatMsg; self: boolean; C: ColorTheme }) {
  const [open, setOpen] = useState(false);
  const desktopSelf = self ? desktopDarkSelfBubble(C) : null;
  const bg = self ? (desktopSelf?.bg ?? C.primary) : C.surface;
  const fg = self ? (desktopSelf?.fg ?? "white") : C.onSurface;
  const fgSub = self
    ? (desktopSelf ? "rgba(28,27,31,.65)" : "rgba(255,255,255,.7)")
    : C.onSurfaceVar;
  const name = msg.fileName || "file";
  const size = msg.fileSize ? formatBytes(msg.fileSize) : "";
  const FileIcon = fileTypeIcon(name);
  const iconChipBg = self
    ? (desktopSelf ? "rgba(28,27,31,.08)" : "rgba(255,255,255,.18)")
    : C.primaryCont;
  const iconChipFg = self ? (desktopSelf ? desktopSelf.fg : "#fff") : C.primary;
  return (
    <div className="max-w-[min(260px,100%)] min-w-0">
      <button onClick={() => setOpen(o=>!o)} className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-all hover:opacity-90" style={{ background:bg, boxShadow:SH1 }}>
        <span className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: iconChipBg, color: iconChipFg }}>
          <FileIcon style={{ fontSize: 22 }} aria-hidden />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{ color:fg, fontFamily:"Roboto" }}>{name}</p>
          {size && <p className="text-[11px]" style={{ color:fgSub, fontFamily:"Roboto" }}>{size}</p>}
        </div>
        <span style={{ color:fgSub, fontSize:18 }}>{open?"▲":"▼"}</span>
      </button>
      {open && (
        <div className="rounded-b-2xl border-t px-4 py-3 flex items-center gap-3" style={{ background: desktopSelf ? "rgba(28,27,31,.06)" : (self?"rgba(0,0,0,.15)":C.surfaceVar), borderColor: desktopSelf ? "rgba(28,27,31,.12)" : (self?"rgba(255,255,255,.2)":C.outlineVar) }}>
          <a href={msg.mediaUrl} download={name} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium no-underline hover:opacity-80 transition-opacity" style={{ background: desktopSelf ? C.primaryCont : (self?"rgba(255,255,255,.2)":C.primaryCont), color: desktopSelf ? C.primary : (self?"white":C.primary), fontFamily:"Roboto" }}>
            <DownloadIcon style={{ fontSize:14 }} /> Download
          </a>
          <span className="text-[11px]" style={{ color:fgSub, fontFamily:"Roboto" }}>{name.split(".").pop()?.toUpperCase()} file</span>
        </div>
      )}
    </div>
  );
}
