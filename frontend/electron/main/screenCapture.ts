/**
 * Electron display-media bridge so getDisplayMedia works in the desktop app.
 * WebRTC screen share (replaceTrack path) is shared with the web client.
 */
import { desktopCapturer, session } from "electron";

const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === "development" || !!process.env.ELECTRON_RENDERER_URL;

function screenLog(...args: unknown[]) {
  if (isDev) console.info("[screen-capture]", ...args);
}

export function registerDisplayMediaHandler() {
  // Prefer the OS picker on Win/macOS; always supply a fallback source for Linux
  // and for environments where the system picker is unavailable.
  const useSystemPicker = process.platform === "win32" || process.platform === "darwin";

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen", "window"],
          thumbnailSize: { width: 0, height: 0 },
          fetchWindowIcons: false,
        });
        screenLog("display-media request", {
          useSystemPicker,
          platform: process.platform,
          sourceCount: sources.length,
          sources: sources.map((s) => ({ id: s.id, name: s.name })),
        });

        const screenSource = sources.find((s) => s.id.startsWith("screen:")) ?? sources[0];
        if (!screenSource) {
          screenLog("no screen sources available — denying");
          callback({});
          return;
        }

        screenLog("granting video source", { id: screenSource.id, name: screenSource.name });
        // When useSystemPicker is true, the OS picker is shown and this source is ignored.
        callback({ video: screenSource });
      } catch (err) {
        console.error("[screen-capture] handler failed", err);
        callback({});
      }
    },
    { useSystemPicker },
  );

  screenLog("display-media handler registered", { useSystemPicker });
}
