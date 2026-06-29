// HIVE MIND Phase 3 worker — companion-side implementation of the same
// poll/claim/heartbeat/complete protocol OrchestratorIDE's HiveWorkerAgent.cs
// uses (OrchestratorIDE/Services/Hive/HiveWorkerAgent.cs + HiveTaskQueue.cs).
//
// Running this loop turns the phone into a real HIVE worker node: it polls a
// Warchief's HiveTaskQueue (port 7079) for tasks matching its lanes, claims
// one, executes it with the on-device model (via the caller-supplied
// runInference callback — wired to the existing local LiteRT/MLC pathway in
// App.tsx), and reports the result back. No Express/server.ts dependency —
// this runs entirely as fetch calls from the WebView, so it works in a
// packaged release APK exactly as it does in `npm run dev`.

const POLL_INTERVAL_MS = 3_000;
const HEARTBEAT_INTERVAL_MS = 10_000;

export interface HiveArtifact {
  source: string;
  role: string;
  content: string;
}

export interface HiveTaskBundle {
  taskId: string;
  sessionId: string;
  role: string;
  title: string;
  spec: string;
  projectGoal: string;
  targetLanguage: string;
  modelHint: string;
  warchiefUrl: string;
  timeoutMs: number;
  upstreamArtifacts: HiveArtifact[];
}

export interface WorkerAgentConfig {
  warchiefUrl: string;
  workerId: string;
  lanes: string[];
  runInference: (spec: string, role: string, modelHint: string) => Promise<string>;
  onLog?: (message: string) => void;
  onTaskActivity?: (taskId: string, message: string) => void;
  onStatusChanged?: (running: boolean) => void;
}

function baseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export class HiveWorkerAgentClient {
  private config: WorkerAgentConfig;
  private abortController: AbortController | null = null;
  private running = false;

  constructor(config: WorkerAgentConfig) {
    this.config = config;
  }

  get isRunning() {
    return this.running;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.abortController = new AbortController();
    this.config.onStatusChanged?.(true);
    this.log(`Worker agent started (id=${this.config.workerId}) — polling ${this.config.warchiefUrl}`);
    void this.runLoop(this.abortController.signal);
  }

  stop() {
    this.running = false;
    this.abortController?.abort();
    this.abortController = null;
    this.config.onStatusChanged?.(false);
    this.log("Worker agent stopped.");
  }

  private log(message: string) {
    this.config.onLog?.(message);
  }

  private activity(taskId: string, message: string) {
    this.config.onTaskActivity?.(taskId, message);
  }

  private async runLoop(signal: AbortSignal) {
    while (!signal.aborted) {
      try {
        const bundle = await this.pollNextTask(signal);
        if (!bundle) {
          await this.delay(POLL_INTERVAL_MS, signal);
          continue;
        }
        this.log(`Received [${bundle.role}] '${bundle.title}' from Warchief`);
        await this.claimAndExecute(bundle, signal);
      } catch (error: any) {
        if (signal.aborted) break;
        this.log(`Worker loop error: ${error?.message || "unknown error"}`);
        await this.delay(5_000, signal).catch(() => undefined);
      }
    }
  }

  private delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }

  private async pollNextTask(signal: AbortSignal): Promise<HiveTaskBundle | null> {
    const lanes = this.config.lanes.length ? this.config.lanes.join(",") : "researcher,coder,uideveloper,tester";
    const url = `${baseUrl(this.config.warchiefUrl)}/hive/tasks/next?lanes=${encodeURIComponent(lanes)}&workerId=${encodeURIComponent(this.config.workerId)}`;
    const response = await fetch(url, { signal });
    if (response.status === 204) return null;
    if (!response.ok) return null;
    return response.json();
  }

  private async claimAndExecute(bundle: HiveTaskBundle, signal: AbortSignal) {
    const claimToken = await this.claimTask(bundle, signal);
    if (claimToken === null) {
      this.log(`[${bundle.role}] '${bundle.title}' — already claimed by another worker`);
      return;
    }

    const startedAt = Date.now();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let result = "";
    let status: "completed" | "failed" = "completed";
    let errorMsg: string | undefined;

    heartbeatTimer = setInterval(() => {
      void this.sendHeartbeat(bundle, claimToken);
    }, HEARTBEAT_INTERVAL_MS);

    try {
      this.activity(bundle.taskId, `Running on ${this.config.workerId}`);
      result = await this.config.runInference(bundle.spec, bundle.role, bundle.modelHint);
    } catch (error: any) {
      status = "failed";
      errorMsg = error?.message || "Execution failed";
      this.log(`[${bundle.role}] '${bundle.title}' — execution failed: ${errorMsg}`);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }

    const durationMs = Date.now() - startedAt;
    const action = status === "completed" ? "complete" : "fail";
    await this.postResult(bundle, action, {
      taskId: bundle.taskId,
      workerId: this.config.workerId,
      workerUrl: "",
      result,
      status,
      errorMsg,
      durationMs,
      claimToken,
    }, signal);

    this.activity(
      bundle.taskId,
      status === "completed"
        ? `Sent to Warchief (${(durationMs / 1000).toFixed(1)}s, ${result.length} chars)`
        : `Failure reported to Warchief: ${errorMsg}`,
    );
  }

  private async claimTask(bundle: HiveTaskBundle, signal: AbortSignal): Promise<string | null> {
    const url = `${baseUrl(this.config.warchiefUrl)}/hive/tasks/${bundle.taskId}/claim`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workerId: this.config.workerId, workerUrl: "", lanes: this.config.lanes }),
      signal,
    });
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    return data?.claimToken ?? "";
  }

  private async sendHeartbeat(bundle: HiveTaskBundle, claimToken: string) {
    try {
      const url = `${baseUrl(this.config.warchiefUrl)}/hive/tasks/${bundle.taskId}/heartbeat`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: this.config.workerId, claimToken }),
      });
    } catch {
      // non-fatal — Warchief watchdog re-queues if heartbeats stop arriving
    }
  }

  private async postResult(
    bundle: HiveTaskBundle,
    action: "complete" | "fail",
    result: {
      taskId: string;
      workerId: string;
      workerUrl: string;
      result: string;
      status: string;
      errorMsg?: string;
      durationMs: number;
      claimToken: string;
    },
    signal: AbortSignal,
  ) {
    const url = `${baseUrl(this.config.warchiefUrl)}/hive/tasks/${bundle.taskId}/${action}`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal,
    }).catch(() => undefined);
  }
}
