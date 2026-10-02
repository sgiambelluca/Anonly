import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export interface RawOsd {
  readonly hostJobId: string;
  readonly tesseractJobId: string;
  readonly rawOrientation: number | null;
  readonly rawConfidence: number | null;
  readonly error: string | null;
  readonly sessionId: string;
  readonly atMs: number;
}
interface Target {
  readonly parent: string | undefined;
  readonly type: string;
  readonly url: string;
}
interface CdpMessage {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  sessionId?: string;
  params?: {
    sessionId?: string;
    targetInfo?: { type: string; url: string };
    name?: string;
    payload?: string;
  };
}

/** Quality-only observer. No image data, heap queries or GC; original messages pass unchanged. */
export class OsdProbe {
  readonly readings: RawOsd[] = [];
  readonly issues: string[] = [];
  readonly targets = new Map<string, Target>();
  private readonly hostJobs = new Map<string, string>();
  private readonly pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly installs = new Set<Promise<void>>();
  private sequence = 0;
  private closing = false;
  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (event) => {
      this.receive(JSON.parse(String(event.data)) as CdpMessage);
    });
  }
  static async connect(userDataDir: string): Promise<OsdProbe> {
    let port = 0;
    const deadline = Date.now() + 15_000;
    while (!port) {
      const content = await readFile(`${userDataDir}/DevToolsActivePort`, "utf8").catch(() => "");
      port = Number(content.split("\n")[0]);
      if (!port && Date.now() > deadline) throw new Error("CDP endpoint unavailable");
      if (!port) await delay(100);
    }
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    const info = (await response.json()) as { webSocketDebuggerUrl: string };
    const socket = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener("error", () => reject(new Error("CDP connection failed")), {
        once: true,
      });
    });
    const probe = new OsdProbe(socket);
    await probe.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true,
    });
    await probe.drain();
    return probe;
  }
  private send(method: string, params: unknown, sessionId?: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout ${method}`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  private receive(message: CdpMessage): void {
    if (message.id !== undefined) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === "Target.attachedToTarget") {
      const session = message.params?.sessionId;
      const info = message.params?.targetInfo;
      if (!session || !info) {
        this.issues.push("invalid CDP attached target");
        return;
      }
      this.targets.set(session, { parent: message.sessionId, type: info.type, url: info.url });
      const task = this.install(session, info.type)
        .catch((error: unknown) => {
          if (!this.closing) this.issues.push(`target installation: ${String(error)}`);
        })
        .finally(() => {
          this.installs.delete(task);
        });
      this.installs.add(task);
    }
    if (
      message.method === "Runtime.bindingCalled" &&
      message.params?.name === "__adr190CdpReport"
    ) {
      const session = message.sessionId;
      if (!session || !message.params.payload) {
        this.issues.push("CDP binding lost session/payload");
        return;
      }
      const data = JSON.parse(message.params.payload) as {
        kind: string;
        jobId: string;
        action?: string;
        status?: string;
        angle?: number | null;
        confidence?: number | null;
        error?: string | null;
      };
      if (data.kind === "host") this.hostJobs.set(session, data.jobId);
      if (data.kind === "detect") {
        let parent = this.targets.get(session)?.parent;
        let host: string | undefined;
        while (parent && !host) {
          host = this.hostJobs.get(parent);
          parent = this.targets.get(parent)?.parent;
        }
        if (!host) {
          this.issues.push(`raw detect ${data.jobId} has no host job`);
          return;
        }
        this.readings.push({
          hostJobId: host,
          tesseractJobId: data.jobId,
          rawOrientation: data.angle ?? null,
          rawConfidence: data.confidence ?? null,
          error: data.error ?? null,
          sessionId: session,
          atMs: Date.now(),
        });
      }
    }
  }
  private async install(sessionId: string, type: string): Promise<void> {
    try {
      await this.send(
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: true, flatten: true },
        sessionId,
      );
      if (type === "worker") {
        await this.send("Runtime.enable", {}, sessionId);
        await this.send("Runtime.addBinding", { name: "__adr190CdpReport" }, sessionId);
        const response = (await this.send(
          "Runtime.evaluate",
          {
            expression: `(() => {
          const report = (value) => globalThis.__adr190CdpReport(JSON.stringify(value));
          self.addEventListener('message', (event) => {
            const m = event.data;
            if (m && m.type === 'RUN' && m.jobType === 'ocr-orient') report({kind:'host',jobId:m.jobId});
          });
          const original = self.postMessage;
          self.postMessage = function(...args) {
            const m = args[0];
            if (m && m.action === 'detect' && (m.status === 'resolve' || m.status === 'reject')) {
              const d = m.data;
              report({kind:'detect',jobId:m.jobId,status:m.status,
                angle:m.status === 'resolve' ? d.orientation_degrees : null,
                confidence:m.status === 'resolve' ? d.orientation_confidence : null,
                error:m.status === 'reject' ? String(d) : d.orientation_degrees === null ? 'DetectOS returned no orientation' : null});
            }
            return Reflect.apply(original, this, args);
          };
        })()`,
          },
          sessionId,
        )) as { exceptionDetails?: unknown };
        if (response.exceptionDetails)
          throw new Error(`observer evaluate failed ${JSON.stringify(response.exceptionDetails)}`);
      }
    } finally {
      await this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    }
  }
  async drain(): Promise<void> {
    while (this.installs.size) await Promise.all([...this.installs]);
  }
  async close(): Promise<void> {
    await this.drain();
    this.closing = true;
    await this.send("Target.setAutoAttach", {
      autoAttach: false,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    this.socket.close();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("CDP closed"));
    }
    this.pending.clear();
  }
}

export function correlateRawOsd(
  jobs: ReadonlyArray<{ jobId: string; jobType: string }>,
  raw: ReadonlyArray<RawOsd>,
): RawOsd[] {
  const orientations = jobs.filter((job) => job.jobType === "ocr-orient");
  if (orientations.length !== raw.length)
    throw new Error(`OSD count mismatch: ${orientations.length} host / ${raw.length} raw`);
  for (const job of orientations) {
    const matches = raw.filter((reading) => reading.hostJobId === job.jobId);
    if (matches.length !== 1) throw new Error(`OSD correlation missing or ambiguous ${job.jobId}`);
    const reading = matches[0];
    if (!reading) throw new Error("missing OSD reading");
    if (
      reading.error === null &&
      (!Number.isFinite(reading.rawOrientation) ||
        !Number.isFinite(reading.rawConfidence) ||
        reading.rawOrientation === null ||
        reading.rawConfidence === null)
    )
      throw new Error("resolved OSD missing raw angle/confidence");
  }
  return [...raw];
}
