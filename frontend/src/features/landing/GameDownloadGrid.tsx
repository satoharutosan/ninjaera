import { useEffect, useState } from "react";
import ComputerIcon from "@mui/icons-material/Computer";
import PhoneAndroidIcon from "@mui/icons-material/PhoneAndroid";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import DownloadIcon from "@mui/icons-material/Download";
import { useC, SH1, FilledBtn, OutlinedBtn } from "@/app/shared";
import { api, type GameDownloadInfo } from "@/app/api";
import { formatGameFileSize } from "@/shared/gameFileSize";
import { toast } from "sonner";

const PLATFORM_META: Record<string, { label: string; Icon: typeof ComputerIcon; reqs: string }> = {
  windows: { label: "Windows", Icon: ComputerIcon, reqs: "Win 10/11 · 8GB RAM" },
  android: { label: "Android", Icon: PhoneAndroidIcon, reqs: "Android 9.0+ · 4GB RAM" },
  ios: { label: "iOS", Icon: PhoneIphoneIcon, reqs: "iOS 15+ · iPhone 12+" },
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type GameDownloadGridProps = {
  compact?: boolean;
};

export function GameDownloadGrid({ compact = false }: GameDownloadGridProps) {
  const C = useC();
  const [gameDownloads, setGameDownloads] = useState<GameDownloadInfo[]>([]);

  useEffect(() => {
    api.content.gameDownloads().then((r) => setGameDownloads(r.downloads)).catch(() => {});
  }, []);

  const handleGameDownload = async (platform: string, available: boolean) => {
    if (!available) {
      toast.info("No published build is available for this platform yet.");
      return;
    }
    try {
      await api.content.downloadGame(platform);
    } catch {
      toast.error("Download failed. Please try again.");
    }
  };

  return (
    <div className={`grid md:grid-cols-3 gap-6 ${compact ? "max-w-3xl mx-auto" : "max-w-3xl mx-auto"}`}>
      {(["windows", "android", "ios"] as const).map((platform) => {
        const meta = PLATFORM_META[platform];
        const info = gameDownloads.find((d) => d.platform === platform);
        const available = info?.available ?? false;
        return (
          <div
            key={platform}
            className="rounded-3xl p-6 text-center hover:scale-[1.02] transition-all"
            style={{ background: C.surface, boxShadow: SH1 }}
          >
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: C.primaryCont }}
            >
              <meta.Icon style={{ fontSize: 28, color: C.primary }} />
            </div>
            <h3 className="font-medium text-base mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              {meta.label}
            </h3>
            {available ? (
              <>
                <p className="text-xs font-medium mb-1" style={{ color: C.primary, fontFamily: "Roboto Mono,monospace" }}>
                  v{info?.version}
                </p>
                <p className="text-xs mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  {formatDate(info?.publishedAt)}
                </p>
                {info?.fileSize ? (
                  <p className="text-[10px] mb-1" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                    {formatGameFileSize(info.fileSize, info.fileSizeUnit)}
                  </p>
                ) : null}
                <p className="text-[10px] mb-5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  {meta.reqs}
                </p>
                <FilledBtn cls="w-full justify-center" onClick={() => handleGameDownload(platform, true)}>
                  <DownloadIcon style={{ fontSize: 16 }} />
                  Download
                </FilledBtn>
              </>
            ) : (
              <>
                <p className="text-xs mb-5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                  Currently unavailable
                </p>
                <OutlinedBtn cls="w-full justify-center opacity-60" onClick={() => handleGameDownload(platform, false)}>
                  Unavailable
                </OutlinedBtn>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
