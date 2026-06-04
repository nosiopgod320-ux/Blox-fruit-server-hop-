const PING_INTERVAL_MS = 5 * 60 * 1000;
const TARGET_URL =
  process.env["PING_URL"] ?? "http://localhost:5000/api/healthz";

async function ping(): Promise<void> {
  try {
    const res = await fetch(TARGET_URL, {
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`[pingbot] ✅ OK ${res.status} — ${new Date().toISOString()}`);
  } catch (err) {
    console.error(`[pingbot] ❌ Failed — ${err}`);
  }
}

ping();
setInterval(ping, PING_INTERVAL_MS);
