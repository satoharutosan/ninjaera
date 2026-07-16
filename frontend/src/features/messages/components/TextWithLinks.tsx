import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { ColorTheme } from "@/app/shared";
import { URL_SPLIT, URL_TEST } from "../constants";

export function TextWithLinks({ text, fg }: { text: string; fg: string }) {
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

export function LinkPreviewCard({ text, self, C }: { text: string; self: boolean; C: ColorTheme }) {
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
