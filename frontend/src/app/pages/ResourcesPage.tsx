import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import DescriptionIcon from "@mui/icons-material/Description";
import GavelIcon from "@mui/icons-material/Gavel";
import ShieldIcon from "@mui/icons-material/Shield";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import VideoLibraryIcon from "@mui/icons-material/VideoLibrary";
import DownloadIcon from "@mui/icons-material/Download";
import imgGarden from "@/imports/262b44b3-ebff-4dc2-a225-62e4b0d5eb8c.png";
import { useC, SH1 } from "@/app/shared";
import { api, ApiError } from "@/app/api";

const CATEGORY_ICONS: Record<string, typeof AutoStoriesIcon> = {
  Guides: AutoStoriesIcon,
  Wiki: DescriptionIcon,
  Downloads: VideoLibraryIcon,
  "Patch Notes": DescriptionIcon,
  Media: PhotoCameraIcon,
};

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function ResourcesPage({ isTeamMember }: { isTeamMember?: boolean }) {
  const C = useC();
  const [tab, setTab] = useState("Guides");
  const tabs = ["Guides", "Wiki", "Downloads", "Patch Notes", "Media"];
  const [resources, setResources] = useState<{ id: number; title: string; category: string; description: string; contentUrl?: string | null; fileSize?: number; version?: string; publishedAt?: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.content.resources()
      .then(r => setResources(r.resources))
      .catch(() => setResources([]))
      .finally(() => setLoading(false));
  }, []);

  const shown = resources.filter(c => c.category === tab);

  const handleDownload = async (id: number, title: string) => {
    if (!isTeamMember) {
      toast.error("Only approved Team Members may download this resource.");
      return;
    }
    try {
      await api.content.downloadResource(id);
      toast.success(`Downloading ${title}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Download failed");
    }
  };

  return (
    <div style={{ background: C.bg }} className="pt-16">
      <div className="relative h-[50vh] overflow-hidden">
        <ImageWithFallback src={imgGarden} alt="Resources" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-center justify-center"><h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily: "'Trade Winds', cursive" }}>Resources</h1></div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="flex flex-wrap gap-2 mb-10">
          {tabs.map(t => <button key={t} onClick={() => setTab(t)} className="px-5 py-2 rounded-full text-sm font-medium transition-all" style={{ background: tab === t ? C.primary : C.surface, color: tab === t ? "white" : C.onSurfaceVar, boxShadow: SH1, fontFamily: "Roboto" }}>{t}</button>)}
        </div>
        {loading ? (
          <p className="text-center py-20 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Loading resources…</p>
        ) : shown.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No resources in this category</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {shown.map(c => {
              const Icon = CATEGORY_ICONS[c.category] || AutoStoriesIcon;
              const meta = [c.category, c.version ? `v${c.version}` : null, c.fileSize ? formatSize(c.fileSize) : null].filter(Boolean).join(" · ");
              return (
                <div key={c.id} className="rounded-3xl p-5 hover:scale-[1.02] transition-all" style={{ background: C.surface, boxShadow: SH1 }}>
                  <div className="w-10 h-10 rounded-full mb-4 flex items-center justify-center" style={{ background: C.primaryCont }}><Icon style={{ fontSize: 18, color: C.primary }} /></div>
                  <div className="text-[10px] mb-2 font-medium" style={{ color: C.onSurfaceVar, fontFamily: "Roboto Mono,monospace" }}>{meta}</div>
                  <h3 className="font-medium text-sm mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{c.title}</h3>
                  <p className="text-xs leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{c.description}</p>
                  <button onClick={() => handleDownload(c.id, c.title)} className="mt-4 flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity" style={{ color: C.primary, fontFamily: "Roboto" }}>
                    <DownloadIcon style={{ fontSize: 14 }} /> Download
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResourcesPage;
