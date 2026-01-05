import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { ENV } from "./env.js";
import { loadSnapshot, saveSnapshot } from "./db.js";

export type ManagedDoc = {
  docId: string;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;

  loaded: boolean;
  loading?: Promise<void>;

  dirty: boolean;
  pendingUpdates: number;

  version: number;
  lastPersistAt: number;
};

export class DocManager {
  private docs = new Map<string, ManagedDoc>();
  private flushTimer: NodeJS.Timeout;

  constructor() {
    this.flushTimer = setInterval(() => {
      this.flushDirty().catch((e) => console.error("[flush] error:", e));
    }, ENV.SNAPSHOT_INTERVAL_MS);

    // allow node to exit naturally if nothing else is keeping it alive
    this.flushTimer.unref?.();
  }

  has(docId: string) {
    return this.docs.has(docId);
  }

  getIfExists(docId: string): ManagedDoc | undefined {
    return this.docs.get(docId);
  }

  async get(docId: string): Promise<ManagedDoc> {
    let doc = this.docs.get(docId);

    if (!doc) {
      const ydoc = new Y.Doc();
      const awareness = new awarenessProtocol.Awareness(ydoc);

      doc = {
        docId,
        ydoc,
        awareness,
        loaded: false,
        dirty: false,
        pendingUpdates: 0,
        version: 0,
        lastPersistAt: 0
      };

      ydoc.on("update", (_u: Uint8Array, origin: unknown) => {
        // don't mark dirty from snapshot-apply
        if (origin === "snapshot") return;
        doc!.dirty = true;
        doc!.pendingUpdates += 1;
      });

      this.docs.set(docId, doc);
    }

    await this.ensureLoaded(doc);
    return doc;
  }

  stats() {
    const docs = Array.from(this.docs.values()).map((d) => ({
      docId: d.docId,
      version: d.version,
      dirty: d.dirty,
      pendingUpdates: d.pendingUpdates,
      awarenessClients: d.awareness.getStates().size,
      loaded: d.loaded,
      lastPersistAt: d.lastPersistAt
    }));

    return { openDocs: docs.length, docs };
  }

  private async ensureLoaded(doc: ManagedDoc): Promise<void> {
    if (doc.loaded) return;
    if (doc.loading) return doc.loading;

    doc.loading = (async () => {
      const { snapshot, version } = await loadSnapshot(doc.docId);

      if (snapshot && snapshot.length > 0) {
        try {
          Y.applyUpdate(doc.ydoc, snapshot, "snapshot");
        } catch (err) {
          console.error("[doc] apply snapshot error:", doc.docId, err);
        }
      }

      doc.version = version;
      doc.dirty = false;
      doc.pendingUpdates = 0;
      doc.loaded = true;
    })();

    await doc.loading;
  }

  private async flushDirty(): Promise<void> {
    const docs = Array.from(this.docs.values());

    await Promise.all(
      docs.map(async (doc) => {
        try {
          if (!doc.loaded) return;

          // requirement: every 2s persist if dirty OR pending over threshold
          if (!doc.dirty && doc.pendingUpdates < ENV.SNAPSHOT_PENDING_THRESHOLD) return;

          const snapshot = Y.encodeStateAsUpdate(doc.ydoc);
          const version = await saveSnapshot(doc.docId, snapshot);

          if (version != null) {
            doc.version = version;
            doc.dirty = false;
            doc.pendingUpdates = 0;
            doc.lastPersistAt = Date.now();
          }
        } catch (err) {
          console.error("[flush] doc error:", doc.docId, err);
        }
      })
    );
  }
}
