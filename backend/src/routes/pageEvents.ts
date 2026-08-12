import { Router } from "express";
import { optionalAuth } from "../middleware/auth.js";
import { logActivitySync } from "../services/activityLog.js";

const router = Router();

/**
 * Public (optional auth) — records Gift funnel visits from /#/terms?type=game.
 */
router.post("/page-events/gift", optionalAuth, (req, res) => {
  logActivitySync({
    req,
    userId: req.user?.id ?? null,
    username: req.user?.username ?? "Guest",
    eventType: "Gift",
    eventCategory: "engagement",
    description: "Gift",
    affectedObject: "terms:type=game",
    result: "success",
    metadata: { page: "terms", type: "game" },
  });
  res.json({ ok: true });
});

export default router;
