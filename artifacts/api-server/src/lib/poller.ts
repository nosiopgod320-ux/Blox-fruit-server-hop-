import { runFullScan } from "./scanner.js";
import { logger } from "./logger.js";

const SCAN_INTERVAL_MS = 10 * 60 * 1000;
const WARMUP_DURATION_MS = 10 * 60 * 1000;

let startedAt: number | null = null;

export function isWarmingUp(): boolean {
  if (startedAt === null) return true;
  return Date.now() - startedAt < WARMUP_DURATION_MS;
}

export function getUptimeSeconds(): number {
  if (startedAt === null) return 0;
  return Math.floor((Date.now() - startedAt) / 1000);
}

export async function startPoller(): Promise<void> {
  startedAt = Date.now();
  logger.info("Poller started — running initial baseline scan");

  try {
    await runFullScan();
  } catch (err) {
    logger.error({ err }, "Initial scan failed");
  }

  setInterval(async () => {
    logger.info("Scheduled scan starting");
    try {
      await runFullScan();
    } catch (err) {
      logger.error({ err }, "Scheduled scan failed");
    }
  }, SCAN_INTERVAL_MS);
}
