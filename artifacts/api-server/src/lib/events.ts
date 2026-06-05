export const SEA_PLACE_IDS: Record<number, string> = {
  1: "2753915549",
  2: "4442272183",
  3: "7449423635",
};

export const PLACE_ID_TO_SEA: Record<string, number> = {
  "2753915549": 1,
  "4442272183": 2,
  "7449423635": 3,
};

export const MAX_SERVER_AGE_SECONDS = 16200; // 4.5 hours

export type EventKey =
  | "fruit"
  | "castle"
  | "factory"
  | "fist"
  | "chalice"
  | "sword";

export interface EventDef {
  key: EventKey;
  name: string;
  intervalSeconds: number;
  seas: number[];
  weekendIntervalSeconds?: number;
  spawnAtSeconds?: number;
  despawnAtSeconds?: number;
}

export const EVENTS: EventDef[] = [
  {
    key: "fruit",
    name: "Fruit Spawn",
    intervalSeconds: 60 * 60,
    weekendIntervalSeconds: 45 * 60,
    seas: [1, 2, 3],
  },
  {
    key: "castle",
    name: "Castle Raid",
    intervalSeconds: 75 * 60,
    seas: [3],
  },
  {
    key: "factory",
    name: "Factory Raid",
    intervalSeconds: 90 * 60,
    seas: [2],
  },
  {
    key: "fist",
    name: "Fist of Darkness",
    intervalSeconds: 4 * 60 * 60,
    seas: [2],
  },
  {
    key: "chalice",
    name: "God's Chalice",
    intervalSeconds: 4 * 60 * 60,
    seas: [3],
  },
  {
    key: "sword",
    name: "Legendary Sword Dealer",
    intervalSeconds: 0,
    seas: [2],
    spawnAtSeconds: 255 * 60,
    despawnAtSeconds: 270 * 60,
  },
];

export function isWeekend(): boolean {
  const day = new Date().getUTCDay();
  return day === 0 || day === 6;
}
