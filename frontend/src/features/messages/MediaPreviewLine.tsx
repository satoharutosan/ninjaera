import { previewKindIcon, resolvePreviewKind, type PreviewKind } from "./mediaIcons";

/** Inline conversation / reply preview: Material icon + label. */
export function MediaPreviewLine({
  text,
  previewKind,
  fileName,
  color,
  iconSize = 14,
  className = "",
}: {
  text?: string | null;
  previewKind?: string | null;
  fileName?: string | null;
  color: string;
  iconSize?: number;
  className?: string;
}) {
  const resolved = resolvePreviewKind({ previewKind, msg: text, fileName });
  const Icon = previewKindIcon(resolved.kind, resolved.fileName || fileName);
  const showIcon = resolved.kind !== "text" && resolved.kind !== "unknown";

  return (
    <span className={`inline-flex items-center gap-1 min-w-0 max-w-full ${className}`} style={{ color, fontFamily: "Roboto" }}>
      {showIcon && <Icon style={{ fontSize: iconSize, flexShrink: 0, opacity: 0.9 }} aria-hidden />}
      <span className="truncate">{resolved.label}</span>
    </span>
  );
}

export type { PreviewKind };
