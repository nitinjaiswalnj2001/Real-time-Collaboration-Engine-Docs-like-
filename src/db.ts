import { Pool } from "pg";
import { ENV } from "./env.js";

export const pg = new Pool({
  host: ENV.PGHOST,
  port: ENV.PGPORT,
  user: ENV.PGUSER,
  password: ENV.PGPASSWORD,
  database: ENV.PGDATABASE
});

let schemaEnsured = false;

export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return;

  await pg.query(`
    CREATE TABLE IF NOT EXISTS docs (
      doc_id TEXT PRIMARY KEY,
      snapshot BYTEA NOT NULL,
      version BIGINT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  schemaEnsured = true;
}

export async function loadSnapshot(
  docId: string
): Promise<{ snapshot: Uint8Array | null; version: number }> {
  try {
    await ensureSchema();
    const r = await pg.query("SELECT snapshot, version FROM docs WHERE doc_id=$1", [docId]);
    if (r.rowCount === 0) return { snapshot: null, version: 0 };

    const buf: Buffer = r.rows[0].snapshot;
    const version = Number(r.rows[0].version ?? 0);

    return { snapshot: new Uint8Array(buf), version };
  } catch (err) {
    console.error("[db] loadSnapshot error:", err);
    return { snapshot: null, version: 0 };
  }
}

export async function saveSnapshot(docId: string, snapshot: Uint8Array): Promise<number | null> {
  try {
    await ensureSchema();
    const buf = Buffer.from(snapshot);

    const r = await pg.query(
      `
      INSERT INTO docs (doc_id, snapshot, version)
      VALUES ($1, $2, 1)
      ON CONFLICT (doc_id)
      DO UPDATE SET snapshot = EXCLUDED.snapshot, version = docs.version + 1, updated_at = now()
      RETURNING version;
      `,
      [docId, buf]
    );

    return Number(r.rows[0].version ?? 0);
  } catch (err) {
    console.error("[db] saveSnapshot error:", err);
    return null;
  }
}
