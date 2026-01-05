import { createClient, type RedisClientType } from "redis";
import { randomUUID } from "crypto";
import { ENV } from "./env.js";

type Incoming = { docId: string; update: number[]; instanceId: string };

export class RedisBus {
  private pub?: RedisClientType;
  private sub?: RedisClientType;
  private enabled = false;

  private readonly instanceId = randomUUID();
  private readonly subscribedDocs = new Set<string>();

  constructor(
    private handlers: {
      onYjs: (docId: string, update: number[]) => void;
      onAwareness: (docId: string, update: number[]) => void;
    }
  ) {}

  isEnabled() {
    return this.enabled;
  }

  async start(): Promise<void> {
    try {
      this.pub = createClient({ url: ENV.REDIS_URL });
      this.sub = createClient({ url: ENV.REDIS_URL });

      this.pub.on("error", (e) => console.error("[redis:pub] error:", e));
      this.sub.on("error", (e) => console.error("[redis:sub] error:", e));

      await this.pub.connect();
      await this.sub.connect();

      this.enabled = true;
      console.log("[redis] connected");
    } catch (err) {
      console.error("[redis] disabled (connect failed):", err);
      this.enabled = false;
    }
  }

  private yjsChannel(docId: string) {
    return `collab:yjs:${docId}`;
  }
  private awChannel(docId: string) {
    return `collab:awareness:${docId}`;
  }

  async ensureDoc(docId: string): Promise<void> {
    if (!this.enabled || !this.sub) return;
    if (this.subscribedDocs.has(docId)) return;

    this.subscribedDocs.add(docId);

    await this.sub.subscribe(this.yjsChannel(docId), (message) => this.handleMessage("yjs", message));
    await this.sub.subscribe(this.awChannel(docId), (message) => this.handleMessage("awareness", message));
  }

  private handleMessage(kind: "yjs" | "awareness", message: string) {
    try {
      const parsed = JSON.parse(message) as Incoming;
      if (!parsed || parsed.instanceId === this.instanceId) return;
      if (!parsed.docId || !Array.isArray(parsed.update)) return;

      if (kind === "yjs") this.handlers.onYjs(parsed.docId, parsed.update);
      else this.handlers.onAwareness(parsed.docId, parsed.update);
    } catch (err) {
      console.error("[redis] bad message:", err);
    }
  }

  async publishYjs(docId: string, update: number[]): Promise<void> {
    if (!this.enabled || !this.pub) return;
    try {
      await this.pub.publish(
        this.yjsChannel(docId),
        JSON.stringify({ docId, update, instanceId: this.instanceId })
      );
    } catch (err) {
      console.error("[redis] publishYjs error:", err);
    }
  }

  async publishAwareness(docId: string, update: number[]): Promise<void> {
    if (!this.enabled || !this.pub) return;
    try {
      await this.pub.publish(
        this.awChannel(docId),
        JSON.stringify({ docId, update, instanceId: this.instanceId })
      );
    } catch (err) {
      console.error("[redis] publishAwareness error:", err);
    }
  }
}
