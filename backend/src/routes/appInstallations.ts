import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { registerAppInstallation } from "../services/appInstallations.js";

const router = Router();

/**
 * Public (optional auth) — silent first-install registration from landing pages.
 * Idempotent on (appId, installationId).
 */
router.post("/app-installations", optionalAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await registerAppInstallation(req, {
      appId: body.appId,
      appName: body.appName,
      appVersion: body.appVersion,
      buildVersion: body.buildVersion,
      releaseChannel: body.releaseChannel,
      installationId: body.installationId,
      platform: body.platform,
      operatingSystem: body.operatingSystem,
    });
    res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    const message = err instanceof Error ? err.message : "Registration failed";
    if (status === 400) {
      res.status(400).json({ error: message });
      return;
    }
    console.error("[app-installations] register failed:", err);
    res.status(500).json({ error: "Unable to register installation" });
  }
});

export default router;
