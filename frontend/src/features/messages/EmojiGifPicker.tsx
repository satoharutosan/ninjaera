import { useEffect, useMemo, useRef, useState } from "react";
import SearchIcon from "@mui/icons-material/Search";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import { useC } from "@/app/shared";
import {
  BUILTIN_GIFS,
  EMOJI_CATEGORIES,
  GIF_CATEGORIES,
  loadFrequentEmojis,
  loadRecentEmojis,
  pushRecentEmoji,
  type EmojiCategoryId,
  type GifItem,
} from "./emojiData";
import { filterPickerEmojis } from "./emojiFilter";
import { searchEmojisByKeyword } from "./emojiKeywords";

type Tab = "emoji" | "gif";

type Props = {
  onPickEmoji: (emoji: string) => void;
  onPickGif: (gif: GifItem) => void;
  onClose?: () => void;
};

function useDebounced(value: string, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Discord-style emoji / GIF picker — lazy-mounted by the parent when opened.
 */
export function EmojiGifPicker({ onPickEmoji, onPickGif }: Props) {
  const C = useC();
  const [tab, setTab] = useState<Tab>("emoji");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 180);
  const [cat, setCat] = useState<EmojiCategoryId | "frequent">("recent");
  const [gifCat, setGifCat] = useState<(typeof GIF_CATEGORIES)[number]["id"]>("trending");
  const [recent, setRecent] = useState<string[]>(() => loadRecentEmojis());
  const [frequent, setFrequent] = useState<string[]>(() => loadFrequentEmojis());
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, [tab]);

  const emojiResults = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (q) {
      const keyed = searchEmojisByKeyword(q);
      if (keyed.length) return keyed;
      const matchedCats = EMOJI_CATEGORIES.filter(
        (c) => c.label.toLowerCase().includes(q) || c.id.includes(q),
      );
      if (matchedCats.length) {
        return filterPickerEmojis(matchedCats.flatMap((c) => c.emojis)).slice(0, 120);
      }
      return [];
    }
    if (cat === "recent") {
      return recent.length ? recent : filterPickerEmojis(EMOJI_CATEGORIES[0]!.emojis).slice(0, 32);
    }
    if (cat === "frequent") return frequent.length ? frequent : recent.slice(0, 24);
    return filterPickerEmojis(EMOJI_CATEGORIES.find((c) => c.id === cat)?.emojis ?? []);
  }, [debounced, cat, recent, frequent]);

  const gifResults = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    let list = BUILTIN_GIFS;
    if (gifCat === "trending") list = BUILTIN_GIFS;
    else list = BUILTIN_GIFS.filter((g) => g.category === gifCat);
    if (q) list = BUILTIN_GIFS.filter((g) => g.label.toLowerCase().includes(q) || g.category.includes(q));
    return list;
  }, [debounced, gifCat]);

  const pickEmoji = (emoji: string) => {
    setRecent(pushRecentEmoji(emoji));
    setFrequent(loadFrequentEmojis());
    onPickEmoji(emoji);
  };

  const sectionLabel = debounced.trim()
    ? "Search results"
    : cat === "recent"
      ? "Recently Used"
      : cat === "frequent"
        ? "Frequently Used"
        : EMOJI_CATEGORIES.find((c) => c.id === cat)?.label ?? "";

  return (
    <div
      className="flex flex-col w-[min(24rem,calc(100vw-1rem))] h-[min(26rem,70vh)] rounded-2xl shadow-2xl border overflow-hidden"
      style={{ background: C.surface, borderColor: C.outlineVar }}
      role="dialog"
      aria-label="Emoji and GIF picker"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex border-b shrink-0" style={{ borderColor: C.outlineVar }}>
        {(["emoji", "gif"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { setTab(t); setQuery(""); }}
            className="flex-1 py-2.5 text-xs font-medium uppercase tracking-widest transition-colors"
            style={{
              color: tab === t ? C.primary : C.onSurfaceVar,
              borderBottom: tab === t ? `2px solid ${C.primary}` : "2px solid transparent",
              fontFamily: "Roboto",
              background: "transparent",
            }}
          >
            {t === "emoji" ? "Emoji" : "GIF"}
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: C.outlineVar }}>
        <div className="flex items-center gap-2 px-3 py-2 rounded-full border" style={{ background: C.surfaceVar, borderColor: C.outlineVar }}>
          <SearchIcon style={{ fontSize: 18, color: C.onSurfaceVar }} aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === "emoji" ? "Search emoji" : "Search GIFs"}
            aria-label={tab === "emoji" ? "Search emoji" : "Search GIFs"}
            className="flex-1 bg-transparent text-sm focus:outline-none min-w-0"
            style={{ color: C.onSurface, fontFamily: "Roboto" }}
          />
        </div>
      </div>

      {tab === "emoji" ? (
        <div className="flex flex-1 min-h-0">
          <div
            className="w-11 shrink-0 overflow-y-auto ninja-scroll border-r flex flex-col items-center py-2 gap-1"
            style={{ borderColor: C.outlineVar }}
            role="tablist"
            aria-label="Emoji categories"
          >
            <button
              type="button"
              title="Recent"
              aria-label="Recent emojis"
              aria-selected={cat === "recent"}
              onClick={() => setCat("recent")}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: cat === "recent" ? C.primaryCont : "transparent", color: C.onSurfaceVar }}
            >
              <AccessTimeIcon style={{ fontSize: 18 }} />
            </button>
            <button
              type="button"
              title="Frequently Used"
              aria-label="Frequently used emojis"
              aria-selected={cat === "frequent"}
              onClick={() => setCat("frequent")}
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: cat === "frequent" ? C.primaryCont : "transparent", color: C.onSurfaceVar }}
            >
              <WhatshotIcon style={{ fontSize: 18 }} />
            </button>
            {EMOJI_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-selected={cat === c.id}
                onClick={() => setCat(c.id)}
                className="w-8 h-8 rounded-lg text-base flex items-center justify-center"
                style={{ background: cat === c.id ? C.primaryCont : "transparent" }}
              >
                {c.icon}
              </button>
            ))}
          </div>
          <div className="flex-1 min-w-0 overflow-y-auto ninja-scroll p-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest px-1 mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              {sectionLabel}
            </p>
            <div className="grid grid-cols-8 gap-0.5" role="listbox" aria-label="Emojis">
              {emojiResults.map((em, i) => (
                <button
                  key={`${em}-${i}`}
                  type="button"
                  role="option"
                  aria-label={`Emoji ${em}`}
                  onClick={() => pickEmoji(em)}
                  className="text-xl w-9 h-9 flex items-center justify-center rounded-lg hover:scale-110 transition-transform focus-visible:outline-none focus-visible:ring-2"
                  style={{ color: C.onSurface }}
                >
                  {em}
                </button>
              ))}
            </div>
            {emojiResults.length === 0 && (
              <p className="text-center text-xs py-8" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                No emoji found
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex gap-1 px-2 py-2 overflow-x-auto shrink-0 ninja-scroll" role="tablist" aria-label="GIF categories">
            {GIF_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setGifCat(c.id)}
                className="px-3 py-1 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0"
                style={{
                  background: gifCat === c.id ? C.primaryCont : C.surfaceVar,
                  color: gifCat === c.id ? C.primary : C.onSurfaceVar,
                  fontFamily: "Roboto",
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto ninja-scroll p-2 min-h-0" style={{ WebkitOverflowScrolling: "touch" }}>
            <div className="columns-2 gap-2">
              {gifResults.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onPickGif(g)}
                  className="break-inside-avoid mb-2 w-full rounded-xl overflow-hidden border hover:opacity-90 transition-opacity text-left focus-visible:outline-none focus-visible:ring-2"
                  style={{ borderColor: C.outlineVar, background: C.surfaceVar }}
                  aria-label={`Send GIF ${g.label}`}
                >
                  <img
                    src={g.previewUrl || g.url}
                    alt=""
                    className="w-full h-auto block bg-black/5"
                    loading="lazy"
                    decoding="async"
                  />
                  <p className="text-[10px] py-1 px-1.5 truncate" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{g.label}</p>
                </button>
              ))}
            </div>
            {gifResults.length === 0 && (
              <p className="text-center text-xs py-8" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                No GIFs found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
