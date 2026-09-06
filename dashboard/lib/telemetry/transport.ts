import type { ClientMsg, ServerMsg } from "../types";
import { FleetEngine } from "../sim/engine";
import { analyseMap, buildMapMsg, type MapConfig, type WarehouseMap } from "../sim/map";
import type { ScenarioName } from "../sim/scenarios";

export type Sink = (msgs: ServerMsg[]) => void;
export type StatusFn = (connected: boolean) => void;

export interface Transport {
  readonly kind: "mock" | "ws";
  start(): Promise<void>;
  stop(): void;
  send(msg: ClientMsg): void;
}

export const MAP_CONFIG_URL = "/maps/map_config.json";

/** Loads the MovingAI map + config exactly the way a backend would serve `/api/map`. */
export async function loadMap(): Promise<{ msg: ReturnType<typeof buildMapMsg>; map: WarehouseMap }> {
  const cfg = (await fetch(MAP_CONFIG_URL).then((r) => r.json())) as MapConfig;
  const text = await fetch(cfg.file).then((r) => r.text());
  const msg = buildMapMsg(text, cfg);
  return { msg, map: analyseMap(msg) };
}

/**
 * In-browser mock transport: runs the FleetEngine on a timer and delivers messages in
 * per-tick batches. Swappable for WsTransport without touching any page.
 */
export class MockTransport implements Transport {
  readonly kind = "mock" as const;
  private engine: FleetEngine | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buffer: ServerMsg[] = [];
  private map: WarehouseMap | null = null;
  private scenario: ScenarioName;
  private seed: number;
  private timeScale = 1;
  private stopped = false;

  constructor(
    private sink: Sink,
    private status: StatusFn,
    initial: { scenario: ScenarioName; seed: number; timeScale?: number },
  ) {
    this.scenario = initial.scenario;
    this.seed = initial.seed;
    this.timeScale = initial.timeScale ?? 1;
  }

  async start() {
    const { msg, map } = await loadMap();
    if (this.stopped) return;
    this.map = map;
    this.sink([msg]);
    this.boot();
  }

  private boot() {
    if (!this.map) return;
    this.clearTimer();
    this.buffer = [];
    this.engine = new FleetEngine({
      map: this.map,
      seed: this.seed,
      scenario: this.scenario,
      robotCount: 10,
      onMessage: (m) => this.buffer.push(m),
      warmupSeconds: this.scenario === "normal" ? 300 : 0,
    });
    this.flush();
    this.status(true);
    this.schedule();
  }

  private schedule() {
    this.clearTimer();
    const interval = Math.max(40, Math.round(200 / this.timeScale));
    this.timer = setInterval(() => {
      if (!this.engine) return;
      this.engine.step(0.2);
      this.flush();
    }, interval);
  }

  private clearTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private flush() {
    if (!this.buffer.length) return;
    const b = this.buffer;
    this.buffer = [];
    this.sink(b);
  }

  send(msg: ClientMsg) {
    switch (msg.type) {
      case "scenario":
        this.scenario = msg.name as ScenarioName;
        this.seed = msg.seed;
        this.boot();
        return;
      case "time_scale":
        this.timeScale = Math.max(0.25, Math.min(4, msg.value));
        this.schedule();
        return;
      default:
        this.engine?.handleClient(msg);
        this.flush();
    }
  }

  stop() {
    this.stopped = true;
    this.clearTimer();
    this.engine = null;
    this.status(false);
  }
}

/** Real WebSocket transport for the FastAPI backend (`ws://host/ws/telemetry`). */
export class WsTransport implements Transport {
  readonly kind = "ws" as const;
  private ws: WebSocket | null = null;
  private buffer: ServerMsg[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private retry = 0;
  private stopped = false;

  constructor(
    private url: string,
    private sink: Sink,
    private status: StatusFn,
  ) {}

  async start() {
    this.stopped = false;
    this.connect();
    this.flushTimer = setInterval(() => {
      if (this.buffer.length) {
        const b = this.buffer;
        this.buffer = [];
        this.sink(b);
      }
    }, 100);
  }

  private connect() {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws.onopen = () => {
      this.retry = 0;
      this.status(true);
    };
    this.ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data));
        if (Array.isArray(data)) this.buffer.push(...(data as ServerMsg[]));
        else this.buffer.push(data as ServerMsg);
      } catch {
        /* ignore malformed frames */
      }
    };
    this.ws.onclose = () => {
      this.status(false);
      this.scheduleRetry();
    };
    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(10000, 500 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  stop() {
    this.stopped = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.ws?.close();
    this.ws = null;
    this.status(false);
  }
}
