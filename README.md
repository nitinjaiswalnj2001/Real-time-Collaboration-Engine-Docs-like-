Absolutely — here is the **exact clean README.md** you can **copy–paste directly** (no extra backticks, no nested fences, no weird formatting).

````md
# Collab Engine (Docs-like Real-time Collaboration)

A minimal real-time collaboration backend similar to Google Docs, built with Node.js + TypeScript + Socket.IO + Yjs.  
Supports live multi-user editing, presence/cursors via Awareness, and Postgres snapshot persistence (Redis optional for multi-instance).

---

## Features

- Docs-like syncing (CRDT) using Yjs updates
- Real-time collaboration with Socket.IO (rooms by docId)
- Presence + cursors + selections using y-protocols Awareness
- Persistence: periodic snapshot storage in Postgres (BYTEA)
- /health and /stats endpoints
- Demo UI in public/index.html (open in two tabs)

---

## Tech Stack

- Backend: Node.js, TypeScript (ESM)
- Realtime: Socket.IO
- CRDT: Yjs
- Presence: y-protocols Awareness
- Database: Postgres (snapshots)
- Optional scaling: Redis pub/sub

---

## Project Structure

collab-engine/
  src/
    index.ts              # Express + Socket.IO server
    docManager.ts         # Doc lifecycle + snapshot persistence loop
    db.ts                 # Postgres schema + load/save snapshot
    env.ts                # env parsing
    types.ts              # shared types
    awarenessCodec.ts     # helper for awareness clientIDs (optional)
  public/
    index.html            # demo editor (2 tabs = realtime)
  docker-compose.yml      # Postgres + Redis (local)
  .env.example
  package.json
  tsconfig.json

---

## Quick Start (Docker Compose Postgres + Redis)

1) Start Postgres + Redis
```bash
docker compose up -d
docker compose ps
````

2. Setup env

```bash
cp .env.example .env
```

3. Install + run

```bash
npm i
npm run dev
```

Open:

* [http://localhost:3000](http://localhost:3000)
* Demo UI: [http://localhost:3000/index.html](http://localhost:3000/index.html)

---

## How to Test Collaboration

1. Open [http://localhost:3000/index.html](http://localhost:3000/index.html) in two tabs
2. Use the same Doc ID
3. Type in one tab → it syncs to the other
4. You should see live users + cursors (Awareness)

---

## API Endpoints

* GET /health  -> { ok: true }
* GET /stats   -> open docs + dirty/persist stats

---

## Architecture

### Sync (Yjs CRDT)

* Each doc is a Y.Doc on the server
* Clients send incremental Yjs updates
* Server applies update and broadcasts to other clients in the same docId room
* New clients receive initial full state from server (Y.encodeStateAsUpdate)

### Presence / Cursors (Awareness)

* Each doc has an Awareness instance
* Clients send awareness updates (name, color, selection)
* Server relays awareness updates to others in the same room
* Presence is not persisted (in-memory only)

### Persistence (Postgres snapshots)

* Server periodically saves a full snapshot (BYTEA) for each doc
* On restart, server loads the latest snapshot and reconstructs Y.Doc
* Table: docs(doc_id TEXT PRIMARY KEY, snapshot BYTEA, version BIGINT, updated_at TIMESTAMPTZ)

---

## Environment Variables

Example .env.example:

```env
PORT=3000

PGHOST=127.0.0.1
PGPORT=5432
PGUSER=collab
PGPASSWORD=collab
PGDATABASE=collabdb

SNAPSHOT_INTERVAL_MS=2000
SNAPSHOT_MAX_UPDATES=50

# Optional shared token for joining docs
JOIN_TOKEN=
```

If JOIN_TOKEN is set, the client must include token in the join payload.

---

## Useful Commands

```bash
docker compose up -d
docker compose down
npm run dev
```

---

## Future Improvements

* Redis pub/sub to broadcast updates across multiple server instances
* Awareness cleanup on disconnect (remove stale cursors)
* Auth (JWT / per-doc ACL)
* More efficient editor UI (avoid full re-render on each update)
* Better selection rendering + multi-line highlights

---

## License

MIT

```
::contentReference[oaicite:0]{index=0}
```
