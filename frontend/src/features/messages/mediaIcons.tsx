import type { SvgIconComponent } from "@mui/icons-material";
import ImageIcon from "@mui/icons-material/Image";
import VideocamIcon from "@mui/icons-material/Videocam";
import MicIcon from "@mui/icons-material/Mic";
import GifBoxIcon from "@mui/icons-material/GifBox";
import DescriptionIcon from "@mui/icons-material/Description";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import ArticleIcon from "@mui/icons-material/Article";
import TableChartIcon from "@mui/icons-material/TableChart";
import SlideshowIcon from "@mui/icons-material/Slideshow";
import CodeIcon from "@mui/icons-material/Code";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import MovieIcon from "@mui/icons-material/Movie";
import NotesIcon from "@mui/icons-material/Notes";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import CallIcon from "@mui/icons-material/Call";
import TextSnippetIcon from "@mui/icons-material/TextSnippet";

export type PreviewKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "gif"
  | "file"
  | "call"
  | "unknown";

const ARCHIVE = new Set(["zip", "rar", "7z", "gz", "tar", "bz2"]);
const DOC = new Set(["doc", "docx", "odt", "rtf"]);
const SHEET = new Set(["xls", "xlsx", "ods", "csv"]);
const SLIDE = new Set(["ppt", "pptx", "odp"]);
const CODE = new Set(["js", "ts", "tsx", "jsx", "json", "xml", "html", "css", "py", "go", "rs", "java", "c", "cpp", "h", "md", "yml", "yaml", "toml", "sql", "sh"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma", "opus", "webm"]);
const VIDEO = new Set(["mp4", "mov", "avi", "mkv", "webm", "wmv", "m4v"]);
const TEXT = new Set(["txt", "log", "ini", "cfg"]);

export function extOf(name?: string | null): string {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** Material icon for a file attachment by extension. */
export function fileTypeIcon(fileName?: string | null): SvgIconComponent {
  const ext = extOf(fileName);
  if (ARCHIVE.has(ext)) return FolderZipIcon;
  if (ext === "pdf") return PictureAsPdfIcon;
  if (DOC.has(ext)) return ArticleIcon;
  if (SHEET.has(ext)) return TableChartIcon;
  if (SLIDE.has(ext)) return SlideshowIcon;
  if (CODE.has(ext)) return CodeIcon;
  if (AUDIO.has(ext)) return AudioFileIcon;
  if (VIDEO.has(ext)) return MovieIcon;
  if (TEXT.has(ext)) return NotesIcon;
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "heic"].includes(ext)) return ImageIcon;
  if (["exe", "msi", "dmg", "apk", "app"].includes(ext)) return InsertDriveFileIcon;
  return InsertDriveFileIcon;
}

export function previewKindIcon(kind: PreviewKind, fileName?: string | null): SvgIconComponent {
  switch (kind) {
    case "image": return ImageIcon;
    case "video": return VideocamIcon;
    case "audio": return MicIcon;
    case "gif": return GifBoxIcon;
    case "call": return CallIcon;
    case "file": return fileTypeIcon(fileName);
    case "text": return TextSnippetIcon;
    default: return DescriptionIcon;
  }
}

/** Strip legacy emoji prefixes from stored conversation previews. */
export function normalizePreviewText(raw: string): string {
  return raw
    .replace(/^📷\s*/u, "")
    .replace(/^🎬\s*/u, "")
    .replace(/^🎤\s*/u, "")
    .replace(/^📎\s*/u, "")
    .replace(/^🗜️\s*/u, "")
    .trim();
}

/**
 * Infer preview kind from API fields and/or legacy emoji-prefixed text.
 */
export function resolvePreviewKind(opts: {
  previewKind?: string | null;
  mediaType?: string | null;
  msg?: string | null;
  fileName?: string | null;
}): { kind: PreviewKind; label: string; fileName?: string } {
  const fromApi = (opts.previewKind || opts.mediaType || "").toLowerCase();
  if (fromApi === "image" || fromApi === "video" || fromApi === "audio" || fromApi === "gif" || fromApi === "file") {
    const label = normalizePreviewText(opts.msg || defaultLabel(fromApi as PreviewKind, opts.fileName));
    return { kind: fromApi as PreviewKind, label, fileName: opts.fileName || undefined };
  }
  if (fromApi === "call_event" || fromApi === "call") {
    return { kind: "call", label: normalizePreviewText(opts.msg || "Call") };
  }

  const msg = opts.msg || "";
  if (/^📷|Image$/u.test(msg) || msg.includes("📷")) {
    return { kind: "image", label: "Image" };
  }
  if (/^🎬|Video$/u.test(msg) || msg.includes("🎬")) {
    return { kind: "video", label: "Video" };
  }
  if (/^🎤|Voice message$/u.test(msg) || msg.includes("🎤")) {
    return { kind: "audio", label: "Voice message" };
  }
  if (msg === "GIF" || msg.startsWith("GIF")) {
    return { kind: "gif", label: "GIF" };
  }
  if (msg.includes("📎") || msg.startsWith("File")) {
    const name = normalizePreviewText(msg.replace(/^File:\s*/i, ""));
    return { kind: "file", label: name || "File", fileName: name };
  }
  if (!msg || msg === "No messages yet") {
    return { kind: "unknown", label: msg || "No messages yet" };
  }
  return { kind: "text", label: msg };
}

function defaultLabel(kind: PreviewKind, fileName?: string | null) {
  switch (kind) {
    case "image": return "Image";
    case "video": return "Video";
    case "audio": return "Voice message";
    case "gif": return "GIF";
    case "file": return fileName || "File";
    case "call": return "Call";
    default: return "";
  }
}
