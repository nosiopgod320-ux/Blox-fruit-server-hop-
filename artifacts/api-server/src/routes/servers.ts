import { Router, type IRouter } from "express";
import { db, serversTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeEventTimers } from "../lib/calculator.js";
import { isWarmingUp, getUptimeSeconds } from "../lib/poller.js";

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
    let rows = await db.select().from(serversTable);

    if (seaParam) {
      const seaNum = Number(seaParam);
      if ([1, 2, 3].includes(seaNum)) {
        rows = rows.filter((r) => r.sea === seaNum);
      }
    }

    const result = rows.map((s) => ({
      jobId: s.jobId,
      placeId: s.placeId,
      sea: s.sea,
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      playerCount: s.playerCount,
      maxPlayers: s.maxPlayers,
      ageSeconds: Math.floor((Date.now() - Number(s.firstSeen)) / 1000),
      events: computeEventTimers(s),
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to get servers");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/best-servers", async (req, res) => {
  try {
    const eventKey = String(req.query["event"] ?? "fruit");
    const within = Number(req.query["within"] ?? 300);

    const rows = await db.select().from(serversTable);
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

export default router;
