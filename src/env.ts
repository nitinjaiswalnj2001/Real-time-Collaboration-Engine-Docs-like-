import dotenv from "dotenv";

dotenv.config();

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function opt(name: string): string | undefined {
  const v = process.env[name];
  if (v == null || v.trim() === "") return undefined;
  return v;
}

export const ENV = {
  PORT: num("PORT", 3000),

  PGHOST: process.env.PGHOST ?? "127.0.0.1",
  PGPORT: num("PGPORT", 5432),
  PGUSER: process.env.PGUSER ?? "collab",
  PGPASSWORD: process.env.PGPASSWORD ?? "collab",
  PGDATABASE: process.env.PGDATABASE ?? "collabdb",

  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  JOIN_TOKEN: opt("JOIN_TOKEN"),

  SNAPSHOT_INTERVAL_MS: 2000,
  SNAPSHOT_PENDING_THRESHOLD: 40
} as const;
