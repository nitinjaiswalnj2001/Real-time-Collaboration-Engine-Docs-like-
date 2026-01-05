import express from "express";
import http from "http";
import { Server as IOServer } from "socket.io";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";

import { ENV } from "./env.js";
import { ensureSchema } from "./db.js";
import { DocManager } from "./docManager.js";
import { RedisBus } from "./redis.js";
import { decodeAwarenessUpdate, toNumberArray, toUint8Array } from "./awarenessCodec.js";
import type { JoinPayload, UpdatePayload } from "./types.js";

process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));

type SocketState = {
  docs: Set<string>;
  awarenessClientIds: Map<string, Set<number>>;
};

async function main() {
  const app = express();
  app.use(express.json());

  const docManager = new DocManager();
  const server = http.createServer(app);
  const io = new IOServer(server, { cors: { origin: true, credentials: true } });

  // Redis: apply cross-instance updates into local docs + broadcast to local sockets
  const redisBus = new RedisBus({
    onYjs: (docId, updateArr) => {
      const doc = docManager.getIfExists(docId);
      if (!doc) return;
      try {
        Y.applyUpdate(doc.ydoc, toUint8Array(updateArr), "redis");
        io.to(docId).emit("yjs-update", { docId, update: updateArr } satisfies UpdatePayload);
      } catch (err) {
        console.error("[redis->yjs] error:", err);
      }
    },
    onAwareness: (docId, updateArr) => {
      const doc = docManager.getIfExists(docId);
      if (!doc) return;
      try {
        awarenessProtocol.applyAwarenessUpdate(doc.awareness, toUint8Array(updateArr), "redis");
        io.to(docId).emit("awareness", { docId, update: updateArr } satisfies UpdatePayload);
      } catch (err) {
        console.error("[redis->awareness] error:", err);
      }
    }
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.get("/stats", (_req, res) => {
    res.json({
      ...docManager.stats(),
      redisEnabled: redisBus.isEnabled()
    });
  });

  app.use(express.static("public"));

  try {
    await ensureSchema();
    console.log("[db] schema ensured");
  } catch (err) {
    console.error("[db] schema ensure failed (continuing):", err);
  }

  await redisBus.start();

  io.on("connection", (socket) => {
    const state: SocketState = {
      docs: new Set(),
      awarenessClientIds: new Map()
    };
    (socket.data as any).state = state;

    socket.on("join", async (payload: JoinPayload) => {
      try {
        const docId = payload?.docId?.trim();
        if (!docId) return;

        if (ENV.JOIN_TOKEN && payload.token !== ENV.JOIN_TOKEN) {
          socket.emit("join-error", { docId, error: "Invalid token" });
          return;
        }

        await redisBus.ensureDoc(docId);

        const doc = await docManager.get(docId);

        state.docs.add(docId);
        socket.join(docId);

        // Full doc sync
        const full = Y.encodeStateAsUpdate(doc.ydoc);
        socket.emit("yjs-sync", { docId, update: toNumberArray(full) } satisfies UpdatePayload);

        // Current awareness snapshot
        const clients = Array.from(doc.awareness.getStates().keys());
        if (clients.length > 0) {
          const aUpdate = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, clients);
          socket.emit("awareness", { docId, update: toNumberArray(aUpdate) } satisfies UpdatePayload);
        }
      } catch (err) {
        console.error("[socket] join error:", err);
        socket.emit("join-error", { docId: payload?.docId, error: "Join failed" });
      }
    });

    socket.on("yjs-update", async (payload: UpdatePayload) => {
      try {
        const docId = payload?.docId;
        if (!docId || !state.docs.has(docId)) return;

        const doc = docManager.getIfExists(docId);
        if (!doc) return;

        Y.applyUpdate(doc.ydoc, toUint8Array(payload.update), socket.id);

        socket.to(docId).emit("yjs-update", payload);
        await redisBus.publishYjs(docId, payload.update);
      } catch (err) {
        console.error("[socket] yjs-update error:", err);
      }
    });

    socket.on("awareness", async (payload: UpdatePayload) => {
      try {
        const docId = payload?.docId;
        if (!docId || !state.docs.has(docId)) return;

        const doc = docManager.getIfExists(docId);
        if (!doc) return;

        const u8 = toUint8Array(payload.update);

        // track per-socket controlled clientIds for cleanup on disconnect
        const { changed, removed } = decodeAwarenessUpdate(u8);
        const set = state.awarenessClientIds.get(docId) ?? new Set<number>();
        for (const id of changed) set.add(id);
        for (const id of removed) set.delete(id);
        state.awarenessClientIds.set(docId, set);

        awarenessProtocol.applyAwarenessUpdate(doc.awareness, u8, socket.id);

        socket.to(docId).emit("awareness", payload);
        await redisBus.publishAwareness(docId, payload.update);
      } catch (err) {
        console.error("[socket] awareness error:", err);
      }
    });

    socket.on("disconnect", async () => {
      // Remove this socket's awareness states from every joined doc
      for (const docId of state.docs) {
        try {
          const doc = docManager.getIfExists(docId);
          if (!doc) continue;

          const ids = Array.from(state.awarenessClientIds.get(docId) ?? []);
          if (ids.length === 0) continue;

          awarenessProtocol.removeAwarenessStates(doc.awareness, ids, "disconnect");
          const update = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, ids);
          const payload: UpdatePayload = { docId, update: toNumberArray(update) };

          io.to(docId).emit("awareness", payload);
          await redisBus.publishAwareness(docId, payload.update);
        } catch (err) {
          console.error("[socket] disconnect cleanup error:", err);
        }
      }
    });
  });

  server.listen(ENV.PORT, () => {
    console.log(`[server] http://localhost:${ENV.PORT}`);
  });
}

main().catch((err) => {
  console.error("[fatal] main error (continuing):", err);
});
