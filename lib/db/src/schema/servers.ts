import { pgTable, text, bigint, integer } from "drizzle-orm/pg-core";

export const serversTable = pgTable("servers", {
  jobId: text("job_id").primaryKey(),
  placeId: bigint("place_id", { mode: "number" }).notNull(),
  sea: integer("sea").notNull(),
  firstSeen: bigint("first_seen", { mode: "number" }).notNull(),
  lastSeen: bigint("last_seen", { mode: "number" }).notNull(),
  playerCount: integer("player_count").notNull().default(0),
  maxPlayers: integer("max_players").notNull().default(0),
});

export type Server = typeof serversTable.$inferSelect;
export type InsertServer = typeof serversTable.$inferInsert;
