import { Router, type IRouter } from "express";
import { db, serversTable, expiredServersTable } from "@workspace/db";
import { desc, eq, gte } from "drizzle-orm";
import { computeEventTimers } from "../lib/calculator.js";
import { isWarmingUp, getUptimeSeconds } from "../lib/poller.js";
import { checkServerAlive } from "../lib/roblox-api.js";
import { SEA_PLACE_IDS } from "../lib/events.js";

const router: IRouter = Router();

router.get("/stats", async (req, res) => {
  try {
    const all = await db.select().from(serversTable);
    const seaCounts = { 1: 0, 2: 0, 3: 0 };
    for (const s of all) {
      const sea = s.sea as 1 | 2 | 3;
      if (sea in seaCounts) seaCounts[sea]++;
    }
    res.json({
      total: all.length,
      seaCounts: { first: seaCounts[1], second: seaCounts[2], third: seaCounts[3] },
      uptimeSeconds: getUptimeSeconds(),
      warmingUp: isWarmingUp(),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/servers", async (req, res) => {
  try {
    const seaParam = req.query["sea"];
    const limit = Math.min(Number(req.query["limit"] ?? 200), 500);

    let rows = await db
      .select()
      .from(serversTable)
      .where(gte(serversTable.scanCount, 2));

    if (seaParam) {
      const seaNum = Number(seaParam);
      if ([1, 2, 3].includes(seaNum)) {
        rows = rows.filter((r) => r.sea === seaNum);
      }
    }

    const now = Date.now();
    const result = rows
      .map((s) => {
        const timers = computeEventTimers(s);
        const nextEvent = Math.min(
          ...timers
            .filter((t) => t.timeUntilSeconds !== null && !t.isActive)
            .map((t) => t.timeUntilSeconds as number),
          9999999,
        );
        return {
          jobId: s.jobId,
          placeId: s.placeId,
          sea: s.sea,
          firstSeen: s.firstSeen,
          lastSeen: s.lastSeen,
          playerCount: s.playerCount,
          maxPlayers: s.maxPlayers,
          ageSeconds: Math.floor((now - Number(s.firstSeen)) / 1000),
          nextEventSeconds: nextEvent,
          events: timers,
        };
      })
      .sort((a, b) => a.nextEventSeconds - b.nextEventSeconds)
      .slice(0, limit);

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get servers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/new-servers", async (req, res) => {
  try {
    const rows = await db.select().from(serversTable).where(eq(serversTable.scanCount, 1));
    res.json(
      rows.map((s) => ({
        jobId: s.jobId,
        placeId: String(s.placeId),
        sea: s.sea,
        firstSeen: Number(s.firstSeen),
        playerCount: s.playerCount,
        maxPlayers: s.maxPlayers,
      })),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to get new servers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/check", async (req, res) => {
  try {
    const jobId = String(req.query["jobId"] ?? "").trim();
    if (!jobId) return res.status(400).json({ error: "jobId required" });

    // Step 1: find the placeId for this job from our DB
    const rows = await db
      .select()
      .from(serversTable)
      .where(eq(serversTable.jobId, jobId));

    if (rows.length === 0) {
      // Not in DB at all — definitely gone
      return res.json({ alive: false, jobId, reason: "not_in_db" });
    }

    const row = rows[0]!;
    const placeId = String(row.placeId);

    // Step 2: verify against Roblox's live API — no inter-page delay, stops
    // immediately when found. This is the authoritative check.
    const alive = await checkServerAlive(placeId, jobId);

    return res.json({ alive, placeId, jobId });
  } catch (err) {
    req.log.error({ err }, "Failed to check server");
    // On error fall back to DB presence — better than blocking the user entirely
    const rows = await db.select().from(serversTable).where(eq(serversTable.jobId, String(req.query["jobId"] ?? "")));
    return res.json({ alive: rows.length > 0, jobId: req.query["jobId"], fallback: true });
  }
});

router.get("/best-servers", async (req, res) => {
  try {
    const eventKey = String(req.query["event"] ?? "fruit");
    const within = Number(req.query["within"] ?? 300);

    const rows = await db
      .select()
      .from(serversTable)
      .where(gte(serversTable.scanCount, 2));

    const results = [];
    for (const s of rows) {
      const timers = computeEventTimers(s);
      const timer = timers.find((t) => t.key === eventKey);
      if (
        timer &&
        timer.timeUntilSeconds !== null &&
        timer.timeUntilSeconds <= within
      ) {
        results.push({
          jobId: s.jobId,
          placeId: s.placeId,
          sea: s.sea,
          playerCount: s.playerCount,
          maxPlayers: s.maxPlayers,
          ageSeconds: Math.floor((Date.now() - Number(s.firstSeen)) / 1000),
          event: timer,
        });
      }
    }

    results.sort(
      (a, b) => (a.event.timeUntilSeconds ?? 0) - (b.event.timeUntilSeconds ?? 0),
    );

    res.json(results);
  } catch (err) {
    req.log.error({ err }, "Failed to get best servers");
    res.status(500).json({ error: "Internal server error" });
  }
});


  // ─── TEMPORARY RESET ENDPOINT (remove after use) ──────────────────────────
  router.post("/admin/reset", async (req, res) => {
    const key = String(req.query["key"] ?? "");
    if (key !== "bloxhop-reset-2026") {
      return res.status(403).json({ error: "Forbidden" });
    }
    try {
      await db.delete(expiredServersTable);
      await db.delete(serversTable);
      req.log.info("DB reset: all servers and expired_servers deleted");
      res.json({ ok: true, message: "All tracked servers cleared. Scanner will repopulate on next scan." });
    } catch (err) {
      req.log.error({ err }, "DB reset failed");
      res.status(500).json({ error: "Reset failed", detail: String(err) });
    }
  });
  // ──────────────────────────────────────────────────────────────────────────

  export default router;
