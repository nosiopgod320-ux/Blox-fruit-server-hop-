import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startPoller } from "./lib/poller.js";
import { ensureSchema, pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function startSelfPing(): void {
  const externalUrl = process.env["RENDER_EXTERNAL_URL"];
  if (!externalUrl) return;

  const target = `${externalUrl}/api/healthz`;
  const INTERVAL_MS = 14 * 60 * 1000;

  setInterval(async () => {
    try {
      const res = await fetch(target, { signal: AbortSignal.timeout(15_000) });
      logger.info({ status: res.status }, "Self-ping OK");
    } catch (err) {
      logger.warn({ err }, "Self-ping failed");
    }
  }, INTERVAL_MS);

  logger.info({ target, intervalMin: 14 }, "Self-ping started");
}

// Ensure DB schema exists BEFORE starting to listen — prevents race condition
// where requests arrive before the scan_count column has been added.
await ensureSchema();
logger.info("Database schema ready");

// Reset tracking session: any servers left in the DB from a previous run get
// their first_seen reset to NOW and scan_count reset to 1. This means:
//   • Server ages start at 0 the moment this process starts — no stale ages.
//   • Every server needs one more confirmation scan before appearing on the
//     dashboard, so the first batch of confirmed servers shows ~10-min-old ages.
await pool.query(`UPDATE servers SET first_seen = $1, scan_count = 1`, [Date.now()]);
logger.info("Session reset — all server ages start from 0");

app.listen(port, () => {
  logger.info({ port }, "Server listening");
  startSelfPing();
  startPoller();
});
