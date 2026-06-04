import { EVENTS, isWeekend, type EventDef } from "./events.js";
import type { Server } from "@workspace/db";

export interface EventTimer {
  key: string;
  name: string;
  timeUntilSeconds: number | null;
  timeUntilFormatted: string | null;
  isAlert: boolean;
  isActive: boolean;
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

export function computeEventTimers(server: Server): EventTimer[] {
  const nowMs = Date.now();
  const serverAgeSeconds = Math.floor((nowMs - Number(server.firstSeen)) / 1000);
  const weekend = isWeekend();

  return EVENTS.filter((e) => e.seas.includes(server.sea)).map(
    (e: EventDef): EventTimer => {
      if (e.key === "sword") {
        const spawnAt = e.spawnAtSeconds!;
        const despawnAt = e.despawnAtSeconds!;

        if (serverAgeSeconds >= spawnAt && serverAgeSeconds < despawnAt) {
          return {
            key: e.key,
            name: e.name,
            timeUntilSeconds: 0,
            timeUntilFormatted: "⚡ ACTIVE",
            isAlert: false,
            isActive: true,
          };
        }

        if (serverAgeSeconds < spawnAt) {
          const remaining = spawnAt - serverAgeSeconds;
          return {
            key: e.key,
            name: e.name,
            timeUntilSeconds: remaining,
            timeUntilFormatted: formatSeconds(remaining),
            isAlert: remaining < 4 * 60,
            isActive: false,
          };
        }

        return {
          key: e.key,
          name: e.name,
          timeUntilSeconds: null,
          timeUntilFormatted: "Passed",
          isAlert: false,
          isActive: false,
        };
      }

      const interval =
        e.key === "fruit" && weekend
          ? (e.weekendIntervalSeconds ?? e.intervalSeconds)
          : e.intervalSeconds;

      const timeInCycle = serverAgeSeconds % interval;
      const remaining = interval - timeInCycle;

      return {
        key: e.key,
        name: e.name,
        timeUntilSeconds: remaining,
        timeUntilFormatted: formatSeconds(remaining),
        isAlert: remaining < 4 * 60,
        isActive: false,
      };
    },
  );
}
