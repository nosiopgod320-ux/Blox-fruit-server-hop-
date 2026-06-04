import app from "./app.js";
import { logger } from "./lib/logger.js";
import { startPoller } from "./lib/poller.js";

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

app.listen(port, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  startSelfPing();
  await startPoller();
});
