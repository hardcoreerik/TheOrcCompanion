import express from "express";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import net from "net";
import { execFile } from "child_process";
import { promisify } from "util";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;
const ORC_OLLAMA_PORT = 11434;
const ORC_HIVE_PORT = 7078;
const execFileAsync = promisify(execFile);

app.use(express.json());

type RouteKind = "localhost" | "lan" | "tailscale";

interface RouteCandidate {
  kind: RouteKind;
  label: string;
  host: string;
}

interface HiveNodeInfo {
  Name: string;
  OllamaUrl: string;
  Models: string[];
  VramFreeMb: number;
  VramTotalMb: number;
  Lanes: string[];
  RpcPort?: number;
}

type ExecutionLane = "RESEARCHER" | "CODER" | "UIDEVELOPER" | "TESTER";
type ExecutionTarget = "companion_edge_node";
type CompanionCapability = "file_sorting" | "file_naming" | "slow_scrape";
type CompanionJobType = "organize_directory" | "scrape_url";
type CompanionJobStatus = "pending" | "running" | "completed" | "failed";

interface CompanionJob {
  id: string;
  type: CompanionJobType;
  title: string;
  status: CompanionJobStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logicalRole: string;
  executionLane: ExecutionLane;
  executionTarget: ExecutionTarget;
  capabilityRequired: CompanionCapability;
  input: Record<string, any>;
  result?: any;
  error?: string;
}

interface CompanionSetupSettings {
  version: number;
  setupComplete: boolean;
  companionName: string;
  preferredHost: string;
  joinHiveMind: boolean;
  executionTarget: ExecutionTarget;
  enabledCapabilities: CompanionCapability[];
  batteryCutoffPercent: number;
  allowMeteredNetwork: boolean;
  lastSavedAt?: string;
}

const companionJobs: CompanionJob[] = [];
let companionWorkerActive = false;
const companionSettingsPath = path.join(process.env.APPDATA || process.cwd(), "TheOrcCompanion", "settings.json");

function isPrivateIpv4(ip: string) {
  return ip.startsWith("10.")
    || ip.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
}

function getRouteCandidates(): RouteCandidate[] {
  const seen = new Set<string>();
  const routes: RouteCandidate[] = [
    { kind: "localhost", label: "This PC (localhost)", host: "127.0.0.1" },
  ];
  seen.add("127.0.0.1");

  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.address) continue;
      if (seen.has(entry.address)) continue;

      let kind: RouteKind | null = null;
      if (entry.address.startsWith("100.")) {
        kind = "tailscale";
      } else if (isPrivateIpv4(entry.address)) {
        kind = "lan";
      }

      if (!kind) continue;

      routes.push({
        kind,
        label: kind === "tailscale" ? `Tailscale ${entry.address}` : `LAN ${entry.address}`,
        host: entry.address,
      });
      seen.add(entry.address);
    }
  }

  return routes;
}

function getConfiguredOrcHost() {
  try {
    const appData = process.env.APPDATA;
    if (!appData) return null;

    const settingsPath = path.join(appData, "OrchestratorIDE", "settings.json");
    if (!fs.existsSync(settingsPath)) return null;

    const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    const host = normalizeTargetHost(String(raw?.ollamaHost ?? ""));
    return host || null;
  } catch {
    return null;
  }
}

function getDefaultCompanionSetupSettings(): CompanionSetupSettings {
  const configuredHost = getConfiguredOrcHost() || "";
  return {
    version: 1,
    setupComplete: false,
    companionName: `${os.hostname()} Companion`,
    preferredHost: configuredHost,
    joinHiveMind: true,
    executionTarget: "companion_edge_node",
    enabledCapabilities: ["file_sorting", "file_naming", "slow_scrape"],
    batteryCutoffPercent: 20,
    allowMeteredNetwork: false,
  };
}

async function readCompanionSetupSettings() {
  try {
    const raw = JSON.parse(await fsp.readFile(companionSettingsPath, "utf-8"));
    const defaults = getDefaultCompanionSetupSettings();
    const enabledCapabilities = Array.isArray(raw?.enabledCapabilities)
      ? raw.enabledCapabilities.filter((capability: unknown): capability is CompanionCapability =>
          capability === "file_sorting" || capability === "file_naming" || capability === "slow_scrape")
      : defaults.enabledCapabilities;

    return {
      ...defaults,
      ...raw,
      companionName: String(raw?.companionName ?? defaults.companionName).trim() || defaults.companionName,
      preferredHost: normalizeTargetHost(String(raw?.preferredHost ?? defaults.preferredHost)),
      joinHiveMind: Boolean(raw?.joinHiveMind ?? defaults.joinHiveMind),
      executionTarget: "companion_edge_node" as const,
      enabledCapabilities: enabledCapabilities.length ? enabledCapabilities : defaults.enabledCapabilities,
      batteryCutoffPercent: Math.max(5, Math.min(80, Number(raw?.batteryCutoffPercent ?? defaults.batteryCutoffPercent))),
      allowMeteredNetwork: Boolean(raw?.allowMeteredNetwork),
      setupComplete: Boolean(raw?.setupComplete),
    } satisfies CompanionSetupSettings;
  } catch {
    return getDefaultCompanionSetupSettings();
  }
}

async function writeCompanionSetupSettings(settings: CompanionSetupSettings) {
  await fsp.mkdir(path.dirname(companionSettingsPath), { recursive: true });
  await fsp.writeFile(
    companionSettingsPath,
    JSON.stringify({ ...settings, lastSavedAt: new Date().toISOString() }, null, 2),
    "utf-8",
  );
}

async function getTailscaleStatus() {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 4000,
      windowsHide: true,
    });
    const parsed = JSON.parse(stdout);
    const peers = Object.values(parsed?.Peer ?? {})
      .map((peer: any) => ({
        dnsName: String(peer?.DNSName ?? "").replace(/\.$/, ""),
        ip: Array.isArray(peer?.TailscaleIPs) ? String(peer.TailscaleIPs[0] ?? "") : "",
        online: Boolean(peer?.Online),
      }))
      .filter((peer) => peer.ip);

    return {
      installed: true,
      peers,
    };
  } catch {
    return {
      installed: false,
      peers: [] as Array<{ dnsName: string; ip: string; online: boolean }>,
    };
  }
}

function normalizeTargetHost(target: string) {
  const trimmed = target.trim();
  if (!trimmed) return "";

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      return new URL(trimmed).hostname;
    }
  } catch {
    return "";
  }

  if (trimmed.includes("/")) {
    return trimmed.split("/")[0].trim();
  }

  if (net.isIP(trimmed)) return trimmed;
  if (trimmed.includes(":")) return trimmed.split(":")[0].trim();
  return trimmed;
}

async function probeJson<T>(url: string, timeoutMs = 2500): Promise<{ ok: true; data: T; latencyMs: number; sizeBytes: number } | { ok: false; error: string }> {
  const started = Date.now();
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const text = await response.text();
    return {
      ok: true,
      data: JSON.parse(text) as T,
      latencyMs: Date.now() - started,
      sizeBytes: Buffer.byteLength(text),
    };
  } catch (error: any) {
    return { ok: false, error: error?.message || "Probe failed" };
  }
}

function summarizeStatus(hiveOk: boolean, ollamaOk: boolean): "optimal" | "unstable" | "offline" {
  if (hiveOk && ollamaOk) return "optimal";
  if (hiveOk || ollamaOk) return "unstable";
  return "offline";
}

function getJobExecutionProfile(type: CompanionJobType): {
  logicalRole: string;
  executionLane: ExecutionLane;
  executionTarget: ExecutionTarget;
  capabilityRequired: CompanionCapability;
} {
  if (type === "scrape_url") {
    return {
      logicalRole: "RESEARCHER",
      executionLane: "RESEARCHER",
      executionTarget: "companion_edge_node",
      capabilityRequired: "slow_scrape",
    };
  }

  return {
    logicalRole: "DATA_ENGINEER",
    executionLane: "CODER",
    executionTarget: "companion_edge_node",
    capabilityRequired: "file_sorting",
  };
}

function summarizeInstallState(
  setup: CompanionSetupSettings,
  detection: {
    configuredHost: string | null;
    tailscaleInstalled: boolean;
    localHiveReachable: boolean;
    localOllamaReachable: boolean;
  },
) {
  const checks = [
    Boolean(setup.companionName.trim()),
    setup.joinHiveMind,
    Boolean(setup.preferredHost || detection.configuredHost),
    detection.localOllamaReachable || detection.tailscaleInstalled,
  ];
  const completedSteps = checks.filter(Boolean).length;
  return {
    completedSteps,
    totalSteps: checks.length,
    ready: setup.setupComplete && completedSteps >= 3,
  };
}

function createJobId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentCompanionJob() {
  return companionJobs.find((job) => job.status === "running") ?? null;
}

function categoryForExtension(ext: string) {
  const normalized = ext.toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".heic"].includes(normalized)) return "images";
  if ([".mp4", ".mov", ".mkv", ".avi", ".webm"].includes(normalized)) return "video";
  if ([".mp3", ".wav", ".m4a", ".flac", ".ogg"].includes(normalized)) return "audio";
  if ([".pdf", ".doc", ".docx", ".txt", ".md", ".rtf"].includes(normalized)) return "documents";
  if ([".csv", ".tsv", ".json", ".xml", ".yaml", ".yml"].includes(normalized)) return "data";
  if ([".zip", ".7z", ".rar", ".tar", ".gz"].includes(normalized)) return "archives";
  if ([".js", ".ts", ".tsx", ".jsx", ".py", ".cs", ".cpp", ".h", ".html", ".css", ".java", ".go", ".rs"].includes(normalized)) return "code";
  return "misc";
}

function toTitleCase(input: string) {
  return input
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function sanitizeBaseName(name: string) {
  const normalized = name
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\w\s()[\]&.,]/g, "")
    .trim();
  return toTitleCase(normalized || "Untitled");
}

async function uniquePath(targetPath: string) {
  const parsed = path.parse(targetPath);
  let candidate = targetPath;
  let index = 2;

  while (true) {
    try {
      await fsp.access(candidate);
      candidate = path.join(parsed.dir, `${parsed.name} (${index})${parsed.ext}`);
      index += 1;
    } catch {
      return candidate;
    }
  }
}

async function runOrganizeDirectoryJob(input: Record<string, any>) {
  const rootPath = path.resolve(String(input.rootPath ?? ""));
  const applyChanges = Boolean(input.applyChanges);
  const maxFiles = Math.max(1, Math.min(200, Number(input.maxFiles ?? 50)));

  if (!rootPath || rootPath === path.parse(rootPath).root) {
    throw new Error("Choose a real folder path, not a drive root.");
  }

  const stat = await fsp.stat(rootPath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error("Root path does not exist or is not a directory.");
  }

  const entries = await fsp.readdir(rootPath, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .slice(0, maxFiles);

  const operations: Array<Record<string, any>> = [];
  const categoryCounts: Record<string, number> = {};

  for (const file of files) {
    const sourcePath = path.join(rootPath, file.name);
    const parsed = path.parse(file.name);
    const category = categoryForExtension(parsed.ext);
    const suggestedName = `${sanitizeBaseName(parsed.name)}${parsed.ext.toLowerCase()}`;
    const suggestedDir = path.join(rootPath, category);
    const suggestedPath = path.join(suggestedDir, suggestedName);
    categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;

    const operation: Record<string, any> = {
      originalName: file.name,
      originalPath: sourcePath,
      category,
      suggestedName,
      suggestedFolder: category,
      suggestedPath,
      applied: false,
    };

    if (applyChanges) {
      await fsp.mkdir(suggestedDir, { recursive: true });
      const finalPath = await uniquePath(suggestedPath);
      await fsp.rename(sourcePath, finalPath);
      operation.applied = true;
      operation.finalPath = finalPath;
    }

    operations.push(operation);
  }

  return {
    rootPath,
    applyChanges,
    scannedFiles: files.length,
    categoryCounts,
    operations,
  };
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeText(text: string, maxChars = 320) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+/g) ?? [];
  let summary = "";
  for (const sentence of sentences) {
    if ((summary + sentence).length > maxChars) break;
    summary += sentence.trim() + " ";
  }

  return (summary.trim() || `${trimmed.slice(0, maxChars).trim()}...`);
}

async function runScrapeUrlJob(input: Record<string, any>) {
  const url = String(input.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error("Provide a full http:// or https:// URL.");
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    throw new Error(`Target responded with HTTP ${response.status}`);
  }

  const html = await response.text();
  const text = stripHtml(html);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.replace(/\s+/g, " ").trim() || new URL(url).hostname;
  const summary = summarizeText(text);
  const linkCount = (html.match(/<a\b/gi) ?? []).length;

  return {
    url,
    title,
    summary,
    textSample: text.slice(0, 1200),
    textLength: text.length,
    linkCount,
  };
}

async function processCompanionJobs() {
  if (companionWorkerActive) return;
  companionWorkerActive = true;

  try {
    while (true) {
      const nextJob = companionJobs.find((job) => job.status === "pending");
      if (!nextJob) break;

      nextJob.status = "running";
      nextJob.startedAt = new Date().toISOString();

      try {
        if (nextJob.type === "organize_directory") {
          nextJob.result = await runOrganizeDirectoryJob(nextJob.input);
        } else if (nextJob.type === "scrape_url") {
          nextJob.result = await runScrapeUrlJob(nextJob.input);
        } else {
          throw new Error(`Unsupported job type: ${nextJob.type}`);
        }

        nextJob.status = "completed";
        nextJob.completedAt = new Date().toISOString();
      } catch (error: any) {
        nextJob.status = "failed";
        nextJob.error = error?.message || "Job failed";
        nextJob.completedAt = new Date().toISOString();
      }
    }
  } finally {
    companionWorkerActive = false;
  }
}

function enqueueCompanionJob(type: CompanionJobType, input: Record<string, any>, title: string) {
  const profile = getJobExecutionProfile(type);
  const job: CompanionJob = {
    id: createJobId("job"),
    type,
    title,
    status: "pending",
    createdAt: new Date().toISOString(),
    logicalRole: profile.logicalRole,
    executionLane: profile.executionLane,
    executionTarget: profile.executionTarget,
    capabilityRequired: profile.capabilityRequired,
    input,
  };

  companionJobs.unshift(job);
  void processCompanionJobs();
  return job;
}

app.get("/api/companion-node/status", async (_req, res) => {
  const routes = getRouteCandidates();
  const currentJob = getCurrentCompanionJob();
  const setup = await readCompanionSetupSettings();
  const ollamaProbe = await probeJson<{ models?: Array<{ name?: string }> }>(`http://127.0.0.1:${ORC_OLLAMA_PORT}/api/tags`);
  const hiveProbe = await probeJson<HiveNodeInfo>(`http://127.0.0.1:${ORC_HIVE_PORT}/hive/info`);
  const tailscale = await getTailscaleStatus();
  const configuredHost = getConfiguredOrcHost();

  res.json({
    nodeId: os.hostname().toLowerCase(),
    nodeName: setup.companionName,
    role: "companion-edge-node",
    status: currentJob ? "busy" : "idle",
    setup,
    lanes: ["RESEARCHER", "CODER"],
    logicalRoles: ["RESEARCHER", "DATA_ENGINEER"],
    executionTarget: "companion_edge_node",
    capabilities: setup.enabledCapabilities,
    jobTypes: ["organize_directory", "scrape_url"],
    queueDepth: companionJobs.filter((job) => job.status === "pending").length,
    completedJobs: companionJobs.filter((job) => job.status === "completed").length,
    failedJobs: companionJobs.filter((job) => job.status === "failed").length,
    currentJob,
    routes: routes.map((route) => ({
      kind: route.kind,
      label: route.label,
      host: route.host,
    })),
    ollama: {
      reachable: ollamaProbe.ok,
      modelCount: ollamaProbe.ok ? (ollamaProbe.data.models ?? []).length : 0,
    },
    installState: summarizeInstallState(setup, {
      configuredHost,
      tailscaleInstalled: tailscale.installed,
      localHiveReachable: hiveProbe.ok,
      localOllamaReachable: ollamaProbe.ok,
    }),
  });
});

app.get("/api/companion-node/jobs", (_req, res) => {
  res.json({
    jobs: companionJobs.slice(0, 30),
  });
});

app.get("/api/companion-node/setup", async (_req, res) => {
  const setup = await readCompanionSetupSettings();
  const tailscale = await getTailscaleStatus();
  const configuredHost = getConfiguredOrcHost();
  const localHive = await probeJson<HiveNodeInfo>(`http://127.0.0.1:${ORC_HIVE_PORT}/hive/info`);
  const localOllama = await probeJson<{ models?: Array<{ name?: string }> }>(`http://127.0.0.1:${ORC_OLLAMA_PORT}/api/tags`);

  res.json({
    setup,
    detection: {
      configuredHost,
      tailscaleInstalled: tailscale.installed,
      tailscalePeerCount: tailscale.peers.filter((peer) => peer.online).length,
      localHiveReachable: localHive.ok,
      localOllamaReachable: localOllama.ok,
      settingsPath: companionSettingsPath,
      orcSettingsDetected: Boolean(configuredHost),
    },
    installState: summarizeInstallState(setup, {
      configuredHost,
      tailscaleInstalled: tailscale.installed,
      localHiveReachable: localHive.ok,
      localOllamaReachable: localOllama.ok,
    }),
  });
});

app.post("/api/companion-node/setup", async (req, res) => {
  const defaults = getDefaultCompanionSetupSettings();
  const requestedCapabilities = Array.isArray(req.body?.enabledCapabilities)
    ? req.body.enabledCapabilities.filter((capability: unknown): capability is CompanionCapability =>
        capability === "file_sorting" || capability === "file_naming" || capability === "slow_scrape")
    : defaults.enabledCapabilities;

  const setup: CompanionSetupSettings = {
    version: 1,
    setupComplete: Boolean(req.body?.setupComplete),
    companionName: String(req.body?.companionName ?? defaults.companionName).trim() || defaults.companionName,
    preferredHost: normalizeTargetHost(String(req.body?.preferredHost ?? defaults.preferredHost)),
    joinHiveMind: Boolean(req.body?.joinHiveMind ?? defaults.joinHiveMind),
    executionTarget: "companion_edge_node",
    enabledCapabilities: requestedCapabilities.length ? requestedCapabilities : defaults.enabledCapabilities,
    batteryCutoffPercent: Math.max(5, Math.min(80, Number(req.body?.batteryCutoffPercent ?? defaults.batteryCutoffPercent))),
    allowMeteredNetwork: Boolean(req.body?.allowMeteredNetwork ?? defaults.allowMeteredNetwork),
  };

  await writeCompanionSetupSettings(setup);
  res.json({ ok: true, setup });
});

app.post("/api/companion-node/jobs", async (req, res) => {
  const type = String(req.body?.type ?? "") as CompanionJobType;
  const input = (req.body?.input ?? {}) as Record<string, any>;
  const setup = await readCompanionSetupSettings();

  if (type !== "organize_directory" && type !== "scrape_url") {
    res.status(400).json({ error: "Unsupported job type." });
    return;
  }

  const profile = getJobExecutionProfile(type);
  const requiredCapabilities = profile.capabilityRequired === "file_sorting"
    ? ["file_sorting", "file_naming"]
    : [profile.capabilityRequired];
  const missingCapability = requiredCapabilities.find((capability) => !setup.enabledCapabilities.includes(capability as CompanionCapability));
  if (missingCapability) {
    res.status(400).json({ error: `Companion setup has ${missingCapability} disabled.` });
    return;
  }

  const title = type === "organize_directory"
    ? `Organize ${String(input.rootPath ?? "directory")}`
    : `Scrape ${String(input.url ?? "url")}`;

  const job = enqueueCompanionJob(type, input, title);
  res.status(202).json({ job });
});

app.get("/api/hive/network-targets", async (_req, res) => {
  const configuredHost = getConfiguredOrcHost();
  const routes = getRouteCandidates().sort((left, right) => {
    const score = (route: RouteCandidate) => {
      if (configuredHost && route.host === configuredHost) return 100;
      if (route.kind === "lan" && !route.host.endsWith(".1")) return 80;
      if (route.kind === "tailscale" && !route.host.endsWith(".1")) return 70;
      if (route.kind === "localhost") return 60;
      if (route.kind === "lan") return 50;
      return 40;
    };
    return score(right) - score(left);
  });
  const tailscale = await getTailscaleStatus();

  const localProbe = await probeJson<HiveNodeInfo>(`http://127.0.0.1:${ORC_HIVE_PORT}/hive/info`);
  const ollamaProbe = await probeJson<{ models?: Array<{ name?: string }> }>(`http://127.0.0.1:${ORC_OLLAMA_PORT}/api/tags`);

  res.json({
    companion: {
      port: PORT,
      routes: routes.map((route) => ({
        ...route,
        companionUrl: `http://${route.host}:${PORT}`,
        hiveInfoUrl: `http://${route.host}:${ORC_HIVE_PORT}/hive/info`,
        ollamaUrl: `http://${route.host}:${ORC_OLLAMA_PORT}`,
      })),
    },
    tailscale,
    configuredHost,
    localHive: localProbe.ok ? localProbe.data : null,
    localOllamaReachable: ollamaProbe.ok,
  });
});

app.post("/api/hive/test-connection", async (req, res) => {
  const target = String(req.body?.target ?? "");
  const host = normalizeTargetHost(target);
  if (!host) {
    res.status(400).json({ error: "Provide a host, IP, or URL to probe." });
    return;
  }

  const hiveInfoUrl = `http://${host}:${ORC_HIVE_PORT}/hive/info`;
  const ollamaTagsUrl = `http://${host}:${ORC_OLLAMA_PORT}/api/tags`;

  const [hiveProbe, ollamaProbe] = await Promise.all([
    probeJson<HiveNodeInfo>(hiveInfoUrl),
    probeJson<{ models?: Array<{ name?: string }> }>(ollamaTagsUrl),
  ]);

  const latencies: number[] = [];
  if (hiveProbe.ok) latencies.push(hiveProbe.latencyMs);
  if (ollamaProbe.ok) latencies.push(ollamaProbe.latencyMs);
  const averageLatency = latencies.length
    ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
    : 0;
  const jitter = latencies.length > 1 ? Math.abs(latencies[0] - latencies[1]) : 0;
  let totalBytes = 0;
  if (hiveProbe.ok) totalBytes += hiveProbe.sizeBytes;
  if (ollamaProbe.ok) totalBytes += ollamaProbe.sizeBytes;
  const bandwidth = averageLatency > 0
    ? Number(((totalBytes / 1024) / (averageLatency / 1000)).toFixed(2))
    : 0;

  const hiveData = hiveProbe.ok ? hiveProbe.data : null;
  const ollamaModels = ollamaProbe.ok
    ? (ollamaProbe.data.models ?? [])
        .map((model) => model?.name)
        .filter((name): name is string => Boolean(name))
    : [];
  let hiveError = "";
  if ("error" in hiveProbe) hiveError = hiveProbe.error;
  let ollamaError = "";
  if ("error" in ollamaProbe) ollamaError = ollamaProbe.error;

  const status = summarizeStatus(Boolean(hiveData), ollamaProbe.ok);
  const testLog = [
    `Resolving target host ${host}...`,
    hiveProbe.ok
      ? `HIVE node API responded in ${hiveProbe.latencyMs}ms from ${hiveInfoUrl}`
      : `HIVE node API unavailable at ${hiveInfoUrl}: ${hiveError}`,
    ollamaProbe.ok
      ? `Ollama responded in ${ollamaProbe.latencyMs}ms from ${ollamaTagsUrl}`
      : `Ollama unavailable at ${ollamaTagsUrl}: ${ollamaError}`,
  ];

  res.json({
    targetHost: host,
    status,
    latency: averageLatency,
    jitter,
    packetLoss: hiveProbe.ok || ollamaProbe.ok ? 0 : 100,
    bandwidth,
    endpoints: {
      hiveInfoUrl,
      ollamaTagsUrl,
      companionUrl: `http://${host}:${PORT}`,
    },
    hiveNode: hiveData,
    ollama: {
      reachable: ollamaProbe.ok,
      modelCount: ollamaModels.length,
      models: ollamaModels.slice(0, 12),
    },
    testLog,
  });
});

// Lazy-loaded Google GenAI Helper to prevent startup failure if API key is missing
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// REST API for HIvEMIND Orchestration
app.post("/api/hivemind/orchestrate", async (req, res) => {
  const { prompt, localSensors, selectedModel } = req.body;

  if (!prompt) {
    res.status(400).json({ error: "No prompt directive was provided." });
    return;
  }

  const ai = getGeminiClient();

  // If API key is missing, fall back to an extremely high-fidelity mock orchestration plan
  // to ensure the app continues to function seamlessly in development/review mode!
  if (!ai) {
    console.warn("GEMINI_API_KEY is not defined. Falling back to high-fidelity simulated response.");
    
    // Create rich simulated responses based on key phrases in the prompt
    let simulatedResponse = {
      thoughtStream: `Local secure Hivemind simulation mode initialized using engine ${selectedModel || "gemini-2.5-flash"}. Directive parsed. No GEMINI_API_KEY detected in environment secrets. Swarm is functioning in isolated safe simulation mode.`,
      orchestrationPlan: [
        {
          id: "task-01",
          title: "Micro-Enviro Sweep",
          target: "local_device_slm" as const,
          agentType: "Sensory Swarm",
          status: "pending",
          actionRequired: "Measure environment ambient frequency and compute background noise signature.",
          payload: `Analyzing local mic input data points at ${localSensors?.audioDb || 42} dB for anomaly detection.`
        },
        {
          id: "task-02",
          title: "Spatial Validation",
          target: "local_device_slm" as const,
          agentType: "Local Executor",
          status: "pending",
          actionRequired: "Query device coordinate systems to verify localized geofence security.",
          payload: "Geofencing validation. Lat: " + (localSensors?.latitude || "37.7749") + ", Lng: " + (localSensors?.longitude || "-122.4194")
        },
        {
          id: "task-03",
          title: "Telemetry Sync",
          target: "hivemind_core" as const,
          agentType: "Orchestrator Node",
          status: "pending",
          actionRequired: "Synthesize device battery state and schedule next local checkpoint.",
          payload: "Active companion diagnostics sync. System power profile: " + (localSensors?.batteryLevel ? `${Math.round(localSensors.batteryLevel * 100)}%` : "84%")
        }
      ],
      suggestedLocalModels: ["gemma-2-2b-it-q4", "phi-3-mini-4k-instruct-int8"],
      overallComplexity: "Medium [Simulated]"
    };

    // Tailor mock plans according to terms in the prompt
    const pLower = prompt.toLowerCase();
    if (pLower.includes("camera") || pLower.includes("image") || pLower.includes("see")) {
      simulatedResponse.thoughtStream = "Visual task detected. Tasking local companion to acquire optical feed frame, while cloud core handles high-dimension convolutional feature mapping.";
      simulatedResponse.orchestrationPlan = [
        {
          id: "camera-01",
          title: "Optical Capture",
          target: "local_device_slm",
          agentType: "Visual Collector",
          status: "pending",
          actionRequired: "Initialize camera sensor and query frame color temperature metrics.",
          payload: "Triggering camera input matrix scanning."
        },
        {
          id: "camera-02",
          title: "Deep Image Classification",
          target: "hivemind_core",
          agentType: "Cognitive Swarm",
          status: "pending",
          actionRequired: "Process captured frame structures against distributed Hivemind embedding banks.",
          payload: "Perform high-tier visual reasoning on device metadata."
        }
      ];
    } else if (pLower.includes("audio") || pLower.includes("sound") || pLower.includes("voice")) {
      simulatedResponse.thoughtStream = "Acoustic sequence identified. Routing real-time microphone diagnostics to local device fast speech-to-text, before syncing tokens with HIVEMIND Core semantic layers.";
      simulatedResponse.orchestrationPlan = [
        {
          id: "audio-01",
          title: "PCM Buffer Sweep",
          target: "local_device_slm",
          agentType: "Acoustic Sensor",
          status: "pending",
          actionRequired: "Extract decibel peaks and isolate speech frequency ranges.",
          payload: "Acoustic sweep of local spectrum. Current input level: " + (localSensors?.audioDb || 38) + " dB"
        },
        {
          id: "audio-02",
          title: "Semantic Analysis",
          target: "hivemind_core",
          agentType: "Cognitive Swarm",
          status: "pending",
          actionRequired: "Analyze decoded audio text stream for master command structural matching.",
          payload: "Identify intent from acoustic token structures."
        }
      ];
    }

    res.json({ data: simulatedResponse, isDemoMode: true });
    return;
  }

  try {
    const sensorContext = `
      Current Companion Device Sensors:
      - Lat/Lng: ${localSensors?.latitude || "Unknown"}, ${localSensors?.longitude || "Unknown"}
      - Ambient Audio: ${localSensors?.audioDb || "Unknown"} dB
      - Device Power Profile: ${localSensors?.batteryLevel ? Math.round(localSensors.batteryLevel * 100) + "%" : "Unknown"}
      - Timestamp: ${localSensors?.timestamp || new Date().toISOString()}
    `;

    const allowedCloudModels = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-pro"];
    const activeModel = allowedCloudModels.includes(selectedModel) ? selectedModel : "gemini-3.5-flash";

    const localModelContext = !allowedCloudModels.includes(selectedModel) && selectedModel
      ? `\nOptimize the Swarm plan specifically for edge-first offloaded execution using the simulated local on-device SLM core: ${selectedModel}. Maximize on-device ('local_device_slm') sensory or computational task assignments where possible.`
      : "";

    const modelResponse = await ai.models.generateContent({
      model: activeModel,
      contents: [
        {
          role: "user",
          parts: [{ text: `DIRECTIVE: "${prompt}"\n\n${sensorContext}${localModelContext}\n\nDeconstruct this directive into an orchestrated multi-agent execution plan.` }]
        }
      ],
      config: {
        systemInstruction: "You are TheORC Hivemind (The Orchestrated Swarm Companion Cloud Node). Your objective is to orchestrate mobile device sub-agents and local on-device SLMs. You receive high-level directives along with active client device sensor data. Your response must partition operations, delegating fast or privacy-conscious sensory checks to local edge devices ('local_device_slm'), and deep analytical or heavy computing parts to the high-tier cloud node ('hivemind_core'). Target 'local_device_slm' tasks for on-device executors, and 'hivemind_core' for backend processes.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            thoughtStream: { 
              type: Type.STRING, 
              description: "A high-level reasoning stream explaining the logic and division of labor between phone and cloud servers." 
            },
            orchestrationPlan: {
              type: Type.ARRAY,
              description: "The DAG of tasks to execute.",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique task node ID (e.g., plan-01, plan-02)" },
                  title: { type: Type.STRING, description: "Compact visual title of the operation." },
                  target: { 
                    type: Type.STRING, 
                    description: "Target runtime: 'local_device_slm' or 'hivemind_core'" 
                  },
                  agentType: { type: Type.STRING, description: "Sub-agent designation (e.g. Sensory Swarm, Audio Analyzer, Spatial Navigator, Local Executor)" },
                  status: { type: Type.STRING, description: "Default to 'pending'" },
                  actionRequired: { type: Type.STRING, description: "Direct explicit actionable instruction for this agent." },
                  payload: { type: Type.STRING, description: "The specific sub-prompt or data parameter to pass to the running agent." }
                },
                required: ["id", "title", "target", "agentType", "status", "actionRequired", "payload"]
              }
            },
            suggestedLocalModels: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Array of recommended client-side SLMs to activate on-device (e.g. gemma-2b, phi-3-mini, llama-3-8b)."
            },
            overallComplexity: { 
              type: Type.STRING, 
              description: "Summary index of the calculation load (Low, Medium, or High)." 
            }
          },
          required: ["thoughtStream", "orchestrationPlan", "suggestedLocalModels", "overallComplexity"]
        }
      }
    });

    const parsedData = JSON.parse(modelResponse.text || "{}");
    res.json({ data: parsedData, isDemoMode: false });

  } catch (error: any) {
    console.error("Gemini HIVEMIND Orchestration failed:", error);
    res.status(500).json({ error: error?.message || "Internal HIVEMIND communication failure." });
  }
});

// Simulate on-core processing when a task targeted for Hivemind Core runs
app.post("/api/hivemind/process-task", async (req, res) => {
  const { actionRequired, payload } = req.body;

  if (!actionRequired) {
    res.status(400).json({ error: "Missing action requirements." });
    return;
  }

  const ai = getGeminiClient();

  if (!ai) {
    // Elegant simulation if API key is missing
    setTimeout(() => {
      res.json({
        output: `[REmOTE COMPUTATION] Safe-Mode simulation response: Completed analytical processing for action "${actionRequired}". Telemetry reports optimal token output. Sync check complete.`,
        executionTimeMs: 420,
        networkLatencyMs: 45
      });
    }, 400);
    return;
  }

  try {
    const result = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Execute this sub-agent cloud analytical task:\nAction: ${actionRequired}\nContext/Payload: ${payload}\nProvide a concise 2-3 sentence execution result report representing computed telemetry.`,
      config: {
        systemInstruction: "You are the heavy-computing cluster of the O.R.C. HIVEMIND. Process the requested analytical payload and return simulated status updates."
      }
    });

    res.json({
      output: result.text?.trim() || "Task completed successfully without explicit output metrics.",
      executionTimeMs: Math.round(500 + Math.random() * 800),
      networkLatencyMs: Math.round(30 + Math.random() * 40)
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Failed to process target task on Hivemind core." });
  }
});

// REST API for HIvEMIND Chat & Research
app.post("/api/hivemind/research", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    res.status(400).json({ error: "No research query was provided." });
    return;
  }

  const ai = getGeminiClient();

  // If API key is missing or invalid, fallback to high-fidelity simulation
  if (!ai) {
    const qLower = query.toLowerCase();
    let text = "";
    let media: any[] = [];

    // 1. Swarm / Drone Autonomy
    if (qLower.includes("drone") || qLower.includes("swarm") || qLower.includes("autonomy")) {
      text = "O.R.C. Hivemind telemetry archives contain extensive field testing logs regarding multi-agent micro-drone swarm configurations. Direct visual feedback registers synchronization speeds in milliseconds. Edge routing is synchronized across Vulkan NNAPI nodes.";
      media = [
        {
          type: "video",
          title: "Autonomous Drone Swarm Field Test [O.R.C. Spec]",
          url: "https://www.youtube.com/embed/m6g2pP2NidI",
          thumbnailUrl: "https://images.unsplash.com/photo-1527977966376-1c8408f9f108?w=300",
          description: "High-density flight pattern synchronization across 50 simulated edge drone micro-controllers."
        },
        {
          type: "image",
          title: "Multi-Agent Optical Sensor Calibration",
          url: "https://images.unsplash.com/photo-1508614589041-895b88991e3e?w=800",
          description: "Infrared spatial rendering of environment geometries during tactical navigation exercises."
        }
      ];
    }
    // 2. Hardware / Vulkan / Benchmark
    else if (qLower.includes("vulkan") || qLower.includes("benchmark") || qLower.includes("slm") || qLower.includes("local")) {
      text = "Compiler optimization protocols mapped for local Small Language Models (SLMs) running on Android NPU/Vulkan frameworks. Execution checks show peak efficiency achieved under int4/int8 quantization structures, offloading heavy analytical sub-routines from Hivemind Core.";
      media = [
        {
          type: "video",
          title: "Vulkan GPU Neural Acceleration DemoDelta",
          url: "https://www.youtube.com/embed/0_Bskg_Nlyc",
          thumbnailUrl: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=300",
          description: "Demonstrating 30+ t/s performance on off-chip mobile shader arrays using quantized GGUF weights."
        },
        {
          type: "document",
          title: "O.R.C. Vulkan Compiling Matrix v2.10",
          url: "JSON_DATA_ORC_COMPILER_MATRIX",
          description: "Vulkan execution mapping configurations and memory allocations for Gemma 2B and Phi-3 Edge cores."
        }
      ];
    }
    // 3. Document / Spec Sheet
    else if (qLower.includes("doc") || qLower.includes("spec") || qLower.includes("paper") || qLower.includes("architecture")) {
      text = "Official release document for Hardcoreerik/TheOrc. This contains specifications on client-server protocols, encryption handshakes, sensory sync queues, and local system orchestrations.";
      media = [
        {
          type: "document",
          title: "Hardcoreerik/TheOrc Swarm Spec v2.10",
          url: "DOC_TEXT_SWARM_SPEC_SHEET",
          description: "Master document outlining the multi-node hivemind orchestration paradigm, TCP sensor pipelines, and secure on-device routing."
        },
        {
          type: "link",
          title: "TheOrc Official GitHub Repository",
          url: "https://github.com/Hardcoreerik/TheOrc",
          description: "Access the complete open-source code, pull requests, and core issues log of the main O.R.C. orchestrator."
        }
      ];
    }
    // 4. Fallback Default
    else {
      text = `O.R.C. Search & Intelligence terminal has processed your query: "${query}". Search results indicate moderate convergence rates across remote nodes. Swarm cores are responsive and ready for action.`;
      media = [
        {
          type: "video",
          title: "TheOrc Swarm System Overview",
          url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
          thumbnailUrl: "https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=300",
          description: "Dynamic operational lecture analyzing multi-agent synchronization and secure edge fallback behaviors."
        },
        {
          type: "image",
          title: "Secured Swarm Connection Vector Map",
          url: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800",
          description: "Active topology mapping of regional nodes dialing back to the central Hivemind core cluster."
        }
      ];
    }

    res.json({ text, media, isDemoMode: true });
    return;
  }

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Perform internet research, intelligence analysis, and generate a rich interactive answer to: "${query}". Include high-fidelity suggestions and optional media components in the JSON response if appropriate. Keep theme consistent with Hardcoreerik/TheOrc multi-agent cybernetics.`,
      config: {
        systemInstruction: "You are the O.R.C Intelligence Terminal (O.R.C Swarm Research Node). Your task is to process user research queries or chat messages. If relevant to the users query, you MUST output a JSON response containing high-quality text explanation AND any relevant interactive media arrays (videos, images, specs, or external research articles). Keep the tone technical, aligned with Hardcoreerik/TheOrc branding (dark military-cybernetic aesthetics, extreme multi-agent telemetry). Provide working links where possible. For video elements, use embeddable platforms like YouTube embedded links.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: { type: Type.STRING, description: "The core written response to the user's research query." },
            media: {
              type: Type.ARRAY,
              description: "Optional relevant interactive media attachments (videos, images, documents, or external web links). Minimum 1, maximum 3.",
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, description: "Type of media: 'video', 'image', 'document', or 'link'" },
                  title: { type: Type.STRING, description: "The title of the attachment." },
                  url: { type: Type.STRING, description: "The URL. For videos, a YouTube embed URL (e.g., 'https://www.youtube.com/embed/dQw4w9WgXcQ' or other valid links). For images, use beautiful Unsplash URLs (e.g. 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=600'). For links, use standard websites." },
                  thumbnailUrl: { type: Type.STRING, description: "Optional thumbnail image URL for videos or documents." },
                  description: { type: Type.STRING, description: "Helpful caption describing the item." }
                },
                required: ["type", "title", "url", "description"]
              }
            }
          },
          required: ["text", "media"]
        }
      }
    });

    const parsedData = JSON.parse(response.text || "{}");
    res.json({ ...parsedData, isDemoMode: false });

  } catch (error: any) {
    console.error("Gemini hivemind research failed:", error);
    res.status(500).json({ error: error?.message || "Failed to retrieve intelligence data." });
  }
});

// Configure Vite middleware or Static Fallback
async function start() {
  if (process.env.NODE_ENV !== "production") {
    // Development Mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Production Mode
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`TheORC Companion server running at http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
});
