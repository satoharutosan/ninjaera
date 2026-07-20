import { useEffect, useState } from "react";
import SettingsIcon from "@mui/icons-material/Settings";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import RemoveIcon from "@mui/icons-material/Remove";
import CropSquareIcon from "@mui/icons-material/CropSquare";
import FilterNoneIcon from "@mui/icons-material/FilterNone";
import CloseIcon from "@mui/icons-material/Close";
import { useC } from "@/app/shared";
import { BrandLogo } from "@/shared/BrandLogo";
import { BRAND_NAME } from "@/shared/branding";
import { getNinja } from "@/shared/electronBridge";

/** Focuses the conversation-list search field (Ctrl/Cmd+F). */
function focusSidebarSearch() {
  const el = document.querySelector<HTMLInputElement>(
    'input[placeholder="Search Conversation"], input[placeholder="Search messages..."]',
  );
  el?.focus();
  el?.select();
}

/**
 * Shared frameless Electron title bar — used on the login window and the
 * main messaging window so height, chrome, and window controls stay identical.
 */
export function TitleBar({
  isDark,
  onToggleTheme,
  onOpenSettings,
}: {
  isDark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}) {
  const C = useC();
  const ninja = getNinja();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!ninja) return;
    ninja.window.isMaximized().then(setMaximized).catch(() => {});
    return ninja.window.onMaximizedChanged(setMaximized);
  }, [ninja]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        focusSidebarSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ctrlBtn =
    "ninja-no-drag ninja-win-btn w-11 h-full flex items-center justify-center";

  return (
    <header
      className="ninja-titlebar flex items-center gap-2 pr-0"
      style={{
        background: C.surface,
        borderBottom: `1px solid ${C.outlineVar}`,
        paddingLeft: 20,
      }}
    >
      <div className="flex items-center gap-2.5 shrink-0">
        <BrandLogo size={22} priority />
        <span
          className="font-medium text-sm"
          style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}
        >
          {BRAND_NAME}
        </span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center h-full shrink-0">
        <button
          type="button"
          onClick={onToggleTheme}
          title="Toggle theme"
          className="ninja-no-drag ninja-win-btn w-9 h-9 rounded-full flex items-center justify-center mr-0.5"
          style={{ color: C.onSurfaceVar }}
        >
          {isDark ? <LightModeIcon style={{ fontSize: 18 }} /> : <DarkModeIcon style={{ fontSize: 18 }} />}
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          title="Settings"
          className="ninja-no-drag ninja-win-btn w-9 h-9 rounded-full flex items-center justify-center mr-1"
          style={{ color: C.onSurfaceVar }}
        >
          <SettingsIcon style={{ fontSize: 18 }} />
        </button>

        <button
          type="button"
          onClick={() => ninja?.window.minimize()}
          title="Minimize"
          className={ctrlBtn}
          style={{ color: C.onSurfaceVar }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(128,128,128,0.15)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          <RemoveIcon style={{ fontSize: 18 }} />
        </button>
        <button
          type="button"
          onClick={() => ninja?.window.maximizeToggle()}
          title={maximized ? "Restore" : "Maximize"}
          className={ctrlBtn}
          style={{ color: C.onSurfaceVar }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(128,128,128,0.15)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {maximized ? (
            <FilterNoneIcon style={{ fontSize: 14 }} />
          ) : (
            <CropSquareIcon style={{ fontSize: 16 }} />
          )}
        </button>
        <button
          type="button"
          onClick={() => ninja?.window.close()}
          title="Close to tray"
          className={ctrlBtn}
          style={{ color: C.onSurfaceVar }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "#E81123";
            e.currentTarget.style.color = "#fff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = C.onSurfaceVar;
          }}
        >
          <CloseIcon style={{ fontSize: 18 }} />
        </button>
      </div>
    </header>
  );
}
