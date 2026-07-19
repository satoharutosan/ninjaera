import { memo } from "react";

type TypingIndicatorStripProps = {
  label: string | null;
  color: string;
};

/**
 * Fixed-height strip above the message composer.
 * Opacity-only transitions — never changes layout or the message list.
 */
export const TypingIndicatorStrip = memo(function TypingIndicatorStrip({
  label,
  color,
}: TypingIndicatorStripProps) {
  const visible = !!label;
  return (
    <div
      className="px-5 shrink-0 flex items-center overflow-hidden"
      style={{ height: 22 }}
      aria-live="polite"
      aria-atomic="true"
    >
      <p
        className="text-xs italic truncate w-full transition-opacity duration-200 ease-out"
        style={{
          color,
          fontFamily: "Roboto",
          opacity: visible ? 1 : 0,
          pointerEvents: "none",
        }}
      >
        {/* Keep a non-breaking space when idle so the line box stays stable. */}
        {label || "\u00a0"}
      </p>
    </div>
  );
});
