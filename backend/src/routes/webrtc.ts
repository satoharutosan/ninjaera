import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { buildIceServers, iceConfigSummary } from "../services/webrtcIce.js";

const router = Router();

/**
 * Authenticated ICE config for WebRTC calls / screen share.
 * Credentials stay server-side; clients fetch at call time.
 */
router.get("/ice-servers", requireAuth, (_req, res) => {
  const iceServers = buildIceServers();
  const summary = iceConfigSummary(iceServers);
  if (process.env.NODE_ENV !== "production") {
    console.info("[webrtc] ice-servers", summary);
  }
  res.json({
    iceServers,
    // Hint for clients: production NAT traversal needs TURN.
    turnConfigured: summary.turn > 0 && summary.hasCredentials,
  });
});

export default router;
