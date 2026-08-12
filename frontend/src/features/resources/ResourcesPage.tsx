import { useState, useEffect } from "react";
import { toast } from "sonner";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import AppsIcon from "@mui/icons-material/Apps";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import PaletteIcon from "@mui/icons-material/Palette";
import CollectionsIcon from "@mui/icons-material/Collections";
import CodeIcon from "@mui/icons-material/Code";
import PublicIcon from "@mui/icons-material/Public";
import LockIcon from "@mui/icons-material/Lock";
import imgGarden from "@/imports/262b44b3-ebff-4dc2-a225-62e4b0d5eb8c.webp";
import { useC, SH1 } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import { RESOURCE_CATEGORIES, type ResourceCategory } from "@/shared/resourceCategories";

const CATEGORY_ICONS: Record<ResourceCategory, typeof AppsIcon> = {
  App: AppsIcon,
  Guide: MenuBookIcon,
  Design: PaletteIcon,
  "Character Art": CollectionsIcon,
  Source: CodeIcon,
};

type ResourceVisibility = "PUBLIC" | "PRIVATE";

type ResourceCard = {
  id: number;
  title: string;
  category: string;
  description: string;
  contentUrl?: string | null;
  fileSize?: number;
  version?: string;
  publishedAt?: string;
  visibility?: ResourceVisibility;
};

function formatSize(bytes?: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function resourceTitleClass(title: string) {
  const compact = !/\s/.test(title) && title.length > 24;
  if (compact && title.length > 48) return "text-xs";
  if (compact || title.length > 56) return "text-sm";
  return "";
}

function ResourcesPage({
  isTeamMember,
  isAdmin,
}: {
  isTeamMember?: boolean;
  isAdmin?: boolean;
}) {
  const C = useC();
  const [tab, setTab] = useState<ResourceCategory>("App");
  const tabs = RESOURCE_CATEGORIES;
  const [resources, setResources] = useState<ResourceCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const canAccessPrivate = !!(isTeamMember || isAdmin);

  const loadResources = () => {
    setLoading(true);
    setLoadError(null);
    api.content.resources()
      .then(r => setResources(r.resources))
      .catch((e) => {
        setResources([]);
        setLoadError(e instanceof ApiError ? e.message : "Failed to load resources. Please try again.");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadResources();
  }, []);

  const shown = resources.filter(c => c.category === tab);

  const handleDownload = async (resource: ResourceCard) => {
    const visibility: ResourceVisibility = resource.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";
    if (visibility === "PRIVATE" && !canAccessPrivate) {
      toast.error("This resource is available only to Team Members and Administrators.");
      return;
    }
    try {
      await api.content.downloadResource(resource.id);
      toast.success(`Downloading ${resource.title}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Download failed");
    }
  };

  return (
    <div style={{ background: C.bg }}>
      <div data-nav-hero className="relative h-[50vh] min-h-[280px] overflow-hidden">
        <ImageWithFallback src={imgGarden} alt="Resources" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-center justify-center pt-16"><h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily: "'Trade Winds', cursive" }}>Resources</h1></div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-14">
        <div className="flex flex-wrap gap-2 mb-10">
          {tabs.map(t => <button key={t} onClick={() => setTab(t)} className="px-5 py-2 rounded-full text-sm font-medium transition-all" style={{ background: tab === t ? C.primary : C.surface, color: tab === t ? "white" : C.onSurfaceVar, boxShadow: SH1, fontFamily: "Roboto" }}>{t}</button>)}
        </div>
        {loading ? (
          <p className="text-center py-20 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Loading resources…</p>
        ) : loadError ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-sm" style={{ color: C.error, fontFamily: "Roboto" }}>{loadError}</p>
            <button
              type="button"
              onClick={loadResources}
              className="px-5 py-2 rounded-full text-sm font-medium text-white"
              style={{ background: C.primary, fontFamily: "Roboto" }}
            >
              Retry
            </button>
          </div>
        ) : shown.length === 0 ? (
          <p className="text-center py-20 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No resources in this category</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {shown.map(c => {
              const Icon = CATEGORY_ICONS[(c.category as ResourceCategory)] || AppsIcon;
              const visibility: ResourceVisibility = c.visibility === "PRIVATE" ? "PRIVATE" : "PUBLIC";
              const isPrivate = visibility === "PRIVATE";
              const meta = [c.category, c.version ? `v${c.version}` : null, c.fileSize ? formatSize(c.fileSize) : null].filter(Boolean).join(" · ");
              return (
                <div key={c.id} className="rounded-3xl p-5 hover:scale-[1.02] transition-all min-w-0 overflow-hidden" style={{ background: C.surface, boxShadow: SH1 }}>
                  <div className="flex items-start justify-between gap-2 mb-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: C.primaryCont }}><Icon style={{ fontSize: 18, color: C.primary }} /></div>
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0"
                      style={{
                        background: isPrivate ? `${C.error}18` : C.primaryCont,
                        color: isPrivate ? C.error : C.primary,
                        fontFamily: "Roboto",
                      }}
                      title={isPrivate ? "Members & Administrators only" : "Anyone can download"}
                    >
                      {isPrivate ? <LockIcon style={{ fontSize: 12 }} /> : <PublicIcon style={{ fontSize: 12 }} />}
                      {isPrivate ? "Private" : "Public"}
                    </span>
                  </div>
                  <h3
                    className={`font-medium mb-1 break-words [overflow-wrap:anywhere] ${resourceTitleClass(c.title)}`}
                    style={{ color: C.onSurface, fontFamily: "Roboto" }}
                  >
                    {c.title}
                  </h3>
                  <p className="text-xs mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{meta}</p>
                  <p className="text-sm mb-4 line-clamp-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{c.description}</p>
                  <button
                    type="button"
                    onClick={() => handleDownload(c)}
                    className="w-full py-2 rounded-full text-sm font-medium text-white"
                    style={{ background: C.primary, fontFamily: "Roboto" }}
                  >
                    Download
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
