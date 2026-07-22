/**
 * afterAllArtifactBuild: re-brand Windows Setup / portable EXEs after NSIS/Squirrel
 * packaging so taskbar / Alt+Tab / Task Manager never fall back to a generic glyph.
 *
 * NSIS already embeds installerIcon for the wizard window; this pass ensures the
 * PE Group Icon + VERSIONINFO (including OriginalFilename) stay correct on the
 * final artifact the user actually double-clicks.
 */
"use strict";

const path = require("path");
const { brandWindowsExecutable, resolveIconPath } = require("./brand-windows-exe.cjs");

exports.default = async function afterAllArtifactBuild(buildResult) {
  const artifactPaths = buildResult.artifactPaths || [];
  const icon = resolveIconPath(path.join(__dirname, ".."));

  for (const artifact of artifactPaths) {
    if (!artifact || !artifact.toLowerCase().endsWith(".exe")) continue;
    const base = path.basename(artifact).toLowerCase();
    // Skip inner unpacked EXEs if ever listed; brand installers + portable only.
    if (base === "ninjaeramessenger.exe" || base === "elevate.exe") continue;
    if (
      base.includes("setup") ||
      base.includes("portable") ||
      base.includes("squirrel")
    ) {
      await brandWindowsExecutable(artifact, icon, {
        originalFilename: path.basename(artifact),
      });
    }
  }
};
