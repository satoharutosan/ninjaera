import LinearProgress from "@mui/material/LinearProgress";
import { useC } from "@/app/shared";

export type AdminUploadPhase = "uploading" | "processing" | "complete";

export type AdminUploadProgressState = {
  filename: string;
  /** 0–100, or -1 when byte total is unknown. */
  percent: number;
  phase: AdminUploadPhase;
};

function formatBytes(n: number): string {
  if (!n || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Material-style upload progress for admin Game / Resource / Link file uploads. */
export function AdminUploadProgress({
  state,
  loaded,
  total,
}: {
  state: AdminUploadProgressState;
  loaded?: number;
  total?: number;
}) {
  const C = useC();
  const isProcessing = state.phase === "processing";
  const isComplete = state.phase === "complete";
  const indeterminate = isProcessing || state.percent < 0;
  // During server processing, keep the bar visually below 100% so "100%" means success only.
  const value = isComplete
    ? 100
    : isProcessing
      ? 95
      : Math.max(0, Math.min(99, state.percent));
  const bytesLabel =
    typeof loaded === "number" && typeof total === "number" && total > 0
      ? `${formatBytes(loaded)} / ${formatBytes(total)}`
      : null;
  const status = isComplete
    ? "Upload complete"
    : isProcessing
      ? "Processing on server… (saving file & database record)"
      : indeterminate
        ? "Uploading…"
        : `${value}% uploaded`;

  return (
    <div
      className="rounded-2xl border p-3 space-y-2"
      style={{ borderColor: C.outlineVar, background: C.surfaceVar }}
      role="status"
      aria-live="polite"
      aria-busy={!isComplete}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            {isComplete
              ? `Uploaded ${state.filename}`
              : isProcessing
                ? "Finishing upload…"
                : `Uploading ${state.filename}`}
          </p>
          {bytesLabel && state.phase === "uploading" && (
            <p className="text-sm mt-0.5 tabular-nums" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              {bytesLabel}
            </p>
          )}
          <p className="text-xs mt-0.5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            {status}
          </p>
        </div>
        {!indeterminate && (
          <span className="text-sm font-medium shrink-0 tabular-nums" style={{ color: C.primary, fontFamily: "Roboto" }}>
            {value}%
          </span>
        )}
      </div>
      <LinearProgress
        variant={indeterminate ? "indeterminate" : "determinate"}
        value={value}
        sx={{
          height: 8,
          borderRadius: 999,
          backgroundColor: C.outlineVar,
          "& .MuiLinearProgress-bar": {
            borderRadius: 999,
            backgroundColor: isComplete ? "#386A20" : C.primary,
            transition: "transform 160ms linear",
          },
        }}
      />
    </div>
  );
}
