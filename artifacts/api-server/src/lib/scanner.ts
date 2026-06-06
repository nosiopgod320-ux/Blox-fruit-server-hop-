import { db, serversTable, expiredServersTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";
import { fetchAllServers } from "./roblox-api.js";
import { SEA_PLACE_IDS, MAX_SERVER_AGE_SECONDS } from "./events.js";
import { logger } from "./logger.js";

export async function scanSea(sea: number): Promise<void> {
  const placeId = SEA_PLACE_IDS[sea];
  if (!placeId) return;

  logger.info({ sea }, "Starting sea scan");

  const liveServers = await fetchAllServers(placeId);

  const nowMs = Date.now();
  const placeIdNum = Number(placeId);

  const existingRows = await db
    .select()
    .from(serversTable)
    .where(eq(serversTable.sea, sea));

  const existingMap = new Map(existingRows.map((r) => [r.jobId, r]));
  const liveMap = new Map(liveServers.map((s) => [s.id, s]));

  const toInsert = [];
  const toUpdate = [];
  const toDelete: typeof existingRows = [];

  for (const s of liveServers) {
    if (existingMap.has(s.id)) {
      toUpdate.push(s);
    } else {
      toInsert.push(s);
    }
  }

  for (const row of existingRows) {
    if (!liveMap.has(row.jobId)) {
      toDelete.push(row);
    }
  }

  for (const s of toInsert) {
    await db.insert(serversTable).values({
      jobId: s.id,
      placeId: placeIdNum,
      sea,
      firstSeen: nowMs,
      lastSeen: nowMs,
      playerCount: s.playing,
      maxPlayers: s.maxPlayers,
      scanCount: 1,
    }).onConflictDoNothing();
  }

  for (const s of toUpdate) {
    await db
      .update(serversTable)
      .set({
        lastSeen: nowMs,
        playerCount: s.playing,
        maxPlayers: s.maxPlayers,
        scanCount: sql`${serversTable.scanCount} + 1`,
      })
      .where(eq(serversTable.jobId, s.id));
  }

  for (const row of toDelete) {
    await db
      .insert(expiredServersTable)
      .values({
        jobId: row.jobId,
        placeId: row.placeId,
        sea: row.sea,
        firstSeen: row.firstSeen,
        lastSeen: row.lastSeen,
        playerCount: row.playerCount,
        maxPlayers: row.maxPlayers,
        scanCount: row.scanCount,
        expiredAt: nowMs,
      })
      .onConflictDoNothing();
    await db.delete(serversTable).where(eq(serversTable.jobId, row.jobId));
  }

  logger.info(
    { sea, inserted: toInsert.length, updated: toUpdate.length, deleted: toDelete.length },
    "Sea scan complete",
  );
}

export async function purgeStaleServers(): Promise<void> {
  const cutoff = Date.now() - MAX_SERVER_AGE_SECONDS * 1000;
  await db.delete(serversTable).where(lt(serversTable.firstSeen, cutoff));
}

export async function runFullScan(): Promise<void> {
  logger.info("Starting full scan of all seas (sequential, rate-limit safe)");
  for (const sea of [1, 2, 3]) {
    await scanSea(sea);
  }
  await purgeStaleServers();
  logger.info("Full scan complete");
}
