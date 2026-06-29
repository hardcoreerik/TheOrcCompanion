import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  MessageSquare,
  Network,
  Play,
  RefreshCw,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
} from "lucide-react";
import {
  BackendId,
  BackendPolicy,
  BackendRecord,
  DeviceProfile,
  DownloadProgress,
  formatBytes,
  GenerationDone,
  isNativeLocalLlmAvailable,
  LaunchArgs,
  LocalLlm,
  LocalModelRecord,
  LocalTranscriptMessage,
  ModelLoadState,
  RuntimeError,
  RuntimeStatus,
  SoakTestResult,
  TokenEvent,
} from "./lib/localLlm";
import { runAgentLoop } from "./lib/agent/runAgentLoop";
import type { ToolActivityEntry } from "./lib/agent/types";
import { HiveWorkerAgentClient } from "./lib/hive/workerAgent";
import { forgetPairedNode, getControlStatus, getPairedNode, pairWithNode, runRemoteTask } from "./lib/hive/controlClient";
import companionIcon from "../assets/02_app_icon.png";

type AppTab = "chat" | "hive" | "jobs" | "settings";
type Message = LocalTranscriptMessage & {
  id: string;
  toolActivity?: ToolActivityEntry[];
  agentStatus?: string;
};
type HiveTrustState = "unpaired_observer" | "pairing_ready" | "paired_member_pending_server_enforcement" | "blocked_untrusted";
type HiveVisibilityState = "visible" | "approved_locally" | "blocked";

interface HiveRoute {
  kind: "localhost" | "lan" | "tailscale";
  label: string;
  host: string;
  companionUrl: string;
  hiveInfoUrl: string;
  ollamaUrl: string;
  trustState: HiveTrustState;
  visibilityState: HiveVisibilityState;
  serverEnforcementKnown: boolean;
}

interface HiveProbeResult {
  status: "optimal" | "unstable" | "offline";
  latency: number;
  endpoints: { hiveInfoUrl: string; ollamaTagsUrl: string; companionUrl: string };
  ollama: { reachable: boolean; modelCount: number; models: string[] };
  hiveNode: { Name: string; Lanes: string[] } | null;
  trustState: HiveTrustState;
  visibilityState: HiveVisibilityState;
  serverEnforcementKnown: boolean;
  protocolContext: {
    protocolVersion: string;
    clientRole: string;
    trustState: HiveTrustState;
    capabilityIntent: string[];
    peerId: string;
    nonce: string;
    timestamp: string;
    authPresent: boolean;
    signatureHeader: string | null;
  };
  testLog: string[];
}

interface KnownHivePeer {
  peerId: string;
  displayName: string;
  routes: Array<{ kind: HiveRoute["kind"]; label: string; host: string }>;
  firstSeenAt: string;
  lastSeenAt: string;
  trustState: HiveTrustState;
  localDecision: "discovered" | "approved_candidate" | "paired_placeholder" | "revoked";
  protocolVersion: string;
  serverEnforcementKnown: boolean;
  peerIdentityKey: string;
}

interface HiveObservationRecord {
  peerId: string;
  displayName: string;
  route: { kind: HiveRoute["kind"]; label: string; host: string };
  observedAt: string;
  firstObservedAt: string;
  visibilityState: HiveVisibilityState;
  trustState: HiveTrustState;
  serverEnforcementKnown: boolean;
}

interface HiveObserverDiagnosticsRecord {
  id: string;
  createdAt: string;
  targetHost: string;
  routeKind: HiveRoute["kind"] | "manual";
  protocolContext: HiveProbeResult["protocolContext"];
  discoverableEndpoints: string[];
  metadataExposure: {
    hiveReachable: boolean;
    ollamaReachable: boolean;
    hiveName?: string;
    laneCount: number;
    modelCount: number;
  };
  refusedOperations: string[];
  notes: string[];
}

interface CompanionJob {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  logicalRole: string;
  executionLane: string;
  capabilityRequired: string;
  error?: string;
}

const PRIMARY_CONVERSATION_ID = "primary";
const CHAT_STORAGE_KEY = "orc-companion-chat-v2";
const SETUP_STORAGE_KEY = "orc-companion-setup-complete";
const DEV_MODE_STORAGE_KEY = "orc-companion-dev-mode";
const BACKEND_POLICY_KEY = "orc-companion-backend-policy";
const PREFERRED_MODEL_KEY = "orc-companion-preferred-model";
const HIVE_ROUTE_STORAGE_KEY = "orc-companion-hive-route";
const OWNER_NAME_STORAGE_KEY = "orc-companion-owner-name";
const AGENT_TOOLS_STORAGE_KEY = "orc-companion-agent-tools";
const ALLOW_METERED_WEB_STORAGE_KEY = "orc-companion-allow-metered-web";
const WORKER_MODE_STORAGE_KEY = "orc-companion-hive-worker-mode";
const WORKER_LANES_DEFAULT = ["researcher"];
const SOAK_SCRIPT_ID = "linked-15-turn-memory";
const AGENT_SOAK_PROMPT = "Use web_search to find the official Google LiteRT-LM Android documentation page, then give me one real URL from the results.";
const API_BASE = ((import.meta as any).env?.VITE_API_BASE ?? "").replace(/\/$/, "");
const PRIMARY_GENERATION_IDLE_TIMEOUT_MS = 8_000;
const PRIMARY_GENERATION_HARD_TIMEOUT_MS = 120_000;
const SOAK_PROMPTS = [
  "Pick a one-word codename for this conversation.",
  "What does that codename mean to you in one short sentence?",
  "Choose a color that matches that codename.",
  "Name a real-world object that fits that color.",
  "Give one adjective that describes that object.",
  "Turn that adjective into a two-word motto.",
  "What simple task would that motto inspire today?",
  "What is the first step of that task?",
  "What obstacle could block that first step?",
  "What is one workaround for that obstacle?",
  "What person or tool would help most with that workaround?",
  "What would you ask that person or tool first?",
  "If the answer were yes, what would you do next?",
  "Summarize the whole plan from this conversation in one sentence.",
  "What was your answer to the first question?",
];

function readStoredMessages(): Message[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) => entry && typeof entry.text === "string" && typeof entry.role === "string");
  } catch {
    return [];
  }
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function toTranscript(messages: Message[]) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant" || message.role === "system")
    .filter((message) => message.text.trim().length > 0)
    .map<LocalTranscriptMessage>((message) => ({
      id: message.id,
      role: message.role,
      text: message.text,
      timestamp: message.timestamp,
      backendId: message.backendId,
      modelId: message.modelId,
    }));
}

function trimTranscript(messages: Message[]) {
  const filtered = messages.filter((message) => message.status !== "streaming");
  let totalChars = 0;
  const kept: Message[] = [];
  for (let index = filtered.length - 1; index >= 0; index -= 1) {
    const message = filtered[index];
    totalChars += message.text.length;
    if (kept.length >= 32 || totalChars > 12_000) break;
    kept.unshift(message);
  }
  return toTranscript(kept);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function deriveContextHealth(messages: Message[]) {
  const totalChars = messages.reduce((sum, message) => sum + message.text.length, 0);
  if (totalChars > 10_000 || messages.length > 24) return "Dense";
  if (totalChars > 4_000 || messages.length > 12) return "Warm";
  return "Fresh";
}

function buildDeviceContextMessage(profile: DeviceProfile | null, ownerName: string, batteryCutoff: number): LocalTranscriptMessage | null {
  if (!profile) return null;

  const parts = [
    `You are chatting on ${profile.deviceLabel ?? `${profile.manufacturer} ${profile.model}`}.`,
    profile.localTimeIso ? `Current local device time is ${profile.localTimeIso}.` : "",
    profile.timezoneId ? `Device timezone is ${profile.timezoneId}.` : "",
    ownerName.trim() ? `The user's name for this device is ${ownerName.trim()}.` : "",
    profile.batteryPercent >= 0 ? `Battery is ${Math.round(profile.batteryPercent)} percent${profile.charging ? " and charging" : ""}.` : "",
    `Do not guess the user's name if it is not provided here.`,
    `If asked for the time, answer using the provided device time context.`,
    `Keep answers grounded to this device context when relevant.`,
    `Avoid claiming access to apps, files, or contacts you were not explicitly given.`,
    `Stop local generation if battery is below ${batteryCutoff} percent when not charging.`,
  ].filter(Boolean);

  return {
    role: "system",
    text: parts.join(" "),
    timestamp: new Date().toISOString(),
  };
}

function formatLocalClock(profile: DeviceProfile | null) {
  if (!profile?.localTimeIso) return null;
  const date = new Date(profile.localTimeIso);
  if (Number.isNaN(date.getTime())) return null;

  const zone = profile.timezoneId;
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    ...(zone ? { timeZone: zone } : {}),
  }).format(date);
  const day = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    ...(zone ? { timeZone: zone } : {}),
  }).format(date);

  return { time, day };
}

function buildDirectDeviceReply(input: string, profile: DeviceProfile | null, ownerName: string) {
  const normalized = normalizeText(input);
  const clock = formatLocalClock(profile);
  const deviceLabel = profile?.deviceLabel ?? (profile ? `${profile.manufacturer} ${profile.model}` : "this device");
  const hasNameIntent = /\b(my name|who am i|what s my name|whats my name|what is my name|tell me my name)\b/.test(normalized);
  const hasTimeIntent = /\b(time|clock)\b/.test(normalized);
  const hasDateIntent = /\b(day|date|today)\b/.test(normalized);
  const hasTimezoneIntent = /\b(timezone|time zone)\b/.test(normalized);
  const hasBatteryIntent = /\b(battery|charge|charging)\b/.test(normalized);
  const hasDeviceIntent = /\b(phone|device|model|what am i running on|what phone am i on)\b/.test(normalized);

  if (hasNameIntent) {
    if (ownerName.trim()) {
      return `Your name on this device is ${ownerName.trim()}.`;
    }
    if (profile?.contactsPermission === "granted") {
      return "I have contacts/profile access, but I still could not find an owner name on this phone.";
    }
    return "I do not know your name yet. Grant contacts/profile access in Settings, or type the name you want me to use.";
  }

  if (hasTimeIntent && clock) {
    if (hasDateIntent) {
      return `It is ${clock.time} on ${clock.day}${profile?.timezoneId ? ` (${profile.timezoneId})` : ""}.`;
    }
    return `It is ${clock.time}${profile?.timezoneId ? ` in ${profile.timezoneId}` : ""}.`;
  }

  if (hasDateIntent && clock) {
    return `Today is ${clock.day}${profile?.timezoneId ? ` in ${profile.timezoneId}` : ""}.`;
  }

  if (hasTimezoneIntent && profile?.timezoneId) {
    return `This phone is using the ${profile.timezoneId} timezone.`;
  }

  if (hasBatteryIntent && profile && profile.batteryPercent >= 0) {
    return `Battery is at ${Math.round(profile.batteryPercent)} percent${profile.charging ? " and charging" : ""}.`;
  }

  if (hasDeviceIntent && profile) {
    return `You are using ${deviceLabel}${profile.androidVersion ? ` on Android ${profile.androidVersion}` : ""}.`;
  }

  return null;
}

function cleanupAssistantDisplayText(text: string) {
  if (!text.trim()) return text;

  const withoutMarkdown = text
    .replace(/```/g, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .replace(/\*/g, "");

  const normalized = withoutMarkdown
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,.;:!?])([A-Za-z])/g, "$1 $2")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s{2,}/g, " ")
    .trim();

  const segments = normalized.match(/[^.!?]+[.!?]?/g)?.map((segment) => segment.trim()).filter(Boolean) ?? [];
  if (segments.length === 0) {
    return normalized;
  }

  const collapsed: string[] = [];
  let previousKey = "";
  let runLength = 0;
  for (const segment of segments) {
    const key = segment.toLowerCase();
    if (key === previousKey) {
      runLength += 1;
    } else {
      previousKey = key;
      runLength = 1;
    }
    if (runLength <= 2) {
      collapsed.push(segment);
    }
  }

  return collapsed.join(" ").replace(/\s{2,}/g, " ").trim();
}

function trustStateLabel(trustState: HiveTrustState) {
  switch (trustState) {
    case "pairing_ready":
      return "Approved locally";
    case "paired_member_pending_server_enforcement":
      return "Pairing prepared";
    case "blocked_untrusted":
      return "Blocked";
    default:
      return "Observed only";
  }
}

function apiUrl(path: string) {
  return API_BASE ? `${API_BASE}${path}` : path;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>("chat");
  const [setupComplete, setSetupComplete] = useState(() => localStorage.getItem(SETUP_STORAGE_KEY) === "true");
  const [profile, setProfile] = useState<DeviceProfile | null>(null);
  const [backends, setBackends] = useState<BackendRecord[]>([]);
  const [models, setModels] = useState<LocalModelRecord[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus | null>(null);
  const [launchArgs, setLaunchArgs] = useState<LaunchArgs>({ runSoakTest: false });
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [loadState, setLoadState] = useState<ModelLoadState | null>(null);
  const [runtimeError, setRuntimeError] = useState("");
  const [backendBanner, setBackendBanner] = useState("");
  const [messages, setMessages] = useState<Message[]>(() => readStoredMessages());
  const [prompt, setPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [batteryCutoff, setBatteryCutoff] = useState(20);
  const [ownerName, setOwnerName] = useState(() => readStoredJson<string>(OWNER_NAME_STORAGE_KEY, ""));
  const [ownerNameAutoDetected, setOwnerNameAutoDetected] = useState("");
  const [developerMode, setDeveloperMode] = useState(() => readStoredJson<boolean>(DEV_MODE_STORAGE_KEY, false));
  const [preferredBackendPolicy, setPreferredBackendPolicy] = useState<BackendPolicy>(() => readStoredJson<BackendPolicy>(BACKEND_POLICY_KEY, "auto"));
  const [preferredModelId, setPreferredModelId] = useState(() => readStoredJson<string>(PREFERRED_MODEL_KEY, "qwen2.5-0.5b-instruct"));
  const [soakTestRunning, setSoakTestRunning] = useState(false);
  const [soakTestResult, setSoakTestResult] = useState<SoakTestResult | null>(null);
  const [agentToolsEnabled, setAgentToolsEnabled] = useState(() => readStoredJson<boolean>(AGENT_TOOLS_STORAGE_KEY, true));
  const [allowMeteredWebSearch, setAllowMeteredWebSearch] = useState(() => readStoredJson<boolean>(ALLOW_METERED_WEB_STORAGE_KEY, true));
  const [lastAgentToolTrace, setLastAgentToolTrace] = useState<ToolActivityEntry[]>([]);
  const agentAbortControllerRef = useRef<AbortController | null>(null);
  const [routes, setRoutes] = useState<HiveRoute[]>([]);
  const [activeRoute, setActiveRoute] = useState<HiveRoute | null>(null);
  const [hiveProbe, setHiveProbe] = useState<HiveProbeResult | null>(null);
  const [hiveBusy, setHiveBusy] = useState(false);
  const [knownPeers, setKnownPeers] = useState<KnownHivePeer[]>([]);
  const [observations, setObservations] = useState<HiveObservationRecord[]>([]);
  const [observerDiagnostics, setObserverDiagnostics] = useState<HiveObserverDiagnosticsRecord | null>(null);
  const [hiveError, setHiveError] = useState("");
  const [jobs, setJobs] = useState<CompanionJob[]>([]);
  const [jobError, setJobError] = useState("");
  const [organizePath, setOrganizePath] = useState("");
  const [scrapeUrl, setScrapeUrl] = useState("");

  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState("");
  const [controlStatus, setControlStatus] = useState<{ nodeName: string; models: string[]; lanes: string[] } | null>(null);
  const [remoteCommandSpec, setRemoteCommandSpec] = useState("");
  const [remoteCommandResult, setRemoteCommandResult] = useState("");
  const [workerModeEnabled, setWorkerModeEnabled] = useState(() => readStoredJson<boolean>(WORKER_MODE_STORAGE_KEY, false));
  const [workerAgentRunning, setWorkerAgentRunning] = useState(false);
  const [workerLog, setWorkerLog] = useState<string[]>([]);
  const workerAgentRef = useRef<HiveWorkerAgentClient | null>(null);

  const generationWaitersRef = useRef<Record<string, {
    text: string;
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    timeoutId: ReturnType<typeof setTimeout>;
  }>>({});
  const autoSoakStartedRef = useRef(false);
  const primaryGenerationStateRef = useRef<{
    idleTimeoutId?: ReturnType<typeof setTimeout>;
    hardTimeoutId?: ReturnType<typeof setTimeout>;
    tokenCount: number;
  }>({ tokenCount: 0 });

  const nativeAvailable = isNativeLocalLlmAvailable();
  const recommendedModel = useMemo(
    () => models.find((model) => model.id === preferredModelId)
      ?? models.find((model) => model.recommended)
      ?? models[0]
      ?? null,
    [models, preferredModelId],
  );
  const loadedModel = useMemo(() => models.find((model) => model.loaded) ?? null, [models]);
  const activeBackend = useMemo(() => backends.find((backend) => backend.id === loadedModel?.backendId) ?? null, [backends, loadedModel]);
  const connectionLabel = loadedModel ? "Local" : hiveProbe?.status === "optimal" ? "Hive Connected" : "Offline";
  const batteryTooLow = profile?.batteryPercent !== undefined && profile.batteryPercent >= 0 && profile.batteryPercent < batteryCutoff && !profile.charging;
  const contextHealth = deriveContextHealth(messages);

  useEffect(() => {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.filter((message) => message.status !== "streaming")));
  }, [messages]);

  useEffect(() => {
    localStorage.setItem(DEV_MODE_STORAGE_KEY, JSON.stringify(developerMode));
  }, [developerMode]);

  useEffect(() => {
    localStorage.setItem(BACKEND_POLICY_KEY, JSON.stringify(preferredBackendPolicy));
  }, [preferredBackendPolicy]);

  useEffect(() => {
    localStorage.setItem(PREFERRED_MODEL_KEY, JSON.stringify(preferredModelId));
  }, [preferredModelId]);

  useEffect(() => {
    localStorage.setItem(OWNER_NAME_STORAGE_KEY, JSON.stringify(ownerName));
  }, [ownerName]);

  useEffect(() => {
    localStorage.setItem(AGENT_TOOLS_STORAGE_KEY, JSON.stringify(agentToolsEnabled));
  }, [agentToolsEnabled]);

  useEffect(() => {
    localStorage.setItem(ALLOW_METERED_WEB_STORAGE_KEY, JSON.stringify(allowMeteredWebSearch));
  }, [allowMeteredWebSearch]);

  useEffect(() => {
    if (activeRoute?.host) {
      localStorage.setItem(HIVE_ROUTE_STORAGE_KEY, JSON.stringify(activeRoute.host));
    }
  }, [activeRoute]);

  useEffect(() => {
    void refreshLocalState();
    void refreshHiveRoutes();
    void refreshJobs();
    void loadPersistedSoakResult();
    void loadObserverDiagnostics();

    const handles: Array<{ remove: () => Promise<void> }> = [];
    void LocalLlm.addListener("downloadProgress", setDownloadProgress).then((handle) => handles.push(handle));
    void LocalLlm.addListener("loadState", handleLoadState).then((handle) => handles.push(handle));
    void LocalLlm.addListener("token", handleToken).then((handle) => handles.push(handle));
    void LocalLlm.addListener("generationDone", handleGenerationDone).then((handle) => handles.push(handle));
    void LocalLlm.addListener("generationCancelled", handleGenerationCancelled).then((handle) => handles.push(handle));
    void LocalLlm.addListener("runtimeError", handleRuntimeError).then((handle) => handles.push(handle));
    void LocalLlm.addListener("backendSwitch", handleBackendSwitch).then((handle) => handles.push(handle));

    return () => {
      clearPrimaryGenerationWatchdog();
      handles.forEach((handle) => void handle.remove());
    };
  }, []);

  useEffect(() => {
    if (!launchArgs.runSoakTest || autoSoakStartedRef.current) return;
    if (!models.length) return;
    autoSoakStartedRef.current = true;
    setDeveloperMode(true);
    setActiveTab("settings");
    void runSoakTest(launchArgs.modelId ?? recommendedModel?.id, launchArgs.backendId);
  }, [launchArgs, models, recommendedModel]);

  async function refreshLocalState() {
    try {
      const [deviceProfile, backendList, modelList, status, args] = await Promise.all([
        LocalLlm.getDeviceProfile(),
        LocalLlm.listBackends(),
        LocalLlm.listModels(),
        LocalLlm.getRuntimeStatus(),
        LocalLlm.getLaunchArgs(),
      ]);
      setProfile(deviceProfile);
      setOwnerNameAutoDetected(deviceProfile.ownerName ?? "");
      setBackends(backendList.backends);
      setModels(modelList.models);
      setRuntimeStatus(status);
      setLaunchArgs(args);
    } catch (error: any) {
      setRuntimeError(error?.message || "Unable to read local model state.");
    }
  }

  async function requestContactsAccess() {
    try {
      const result = await LocalLlm.requestContactsAccess();
      if (result.ownerName) {
        setOwnerNameAutoDetected(result.ownerName);
      }
      await refreshLocalState();
    } catch (error: any) {
      setRuntimeError(error?.message || "Unable to request contacts access.");
    }
  }

  async function maybeResolveDirectDeviceReply(input: string) {
    try {
      const latestProfile = await LocalLlm.getDeviceProfile();
      setProfile(latestProfile);
      setOwnerNameAutoDetected(latestProfile.ownerName ?? "");
      const resolvedOwnerName = ownerName.trim() || latestProfile.ownerName?.trim() || ownerNameAutoDetected.trim();
      return buildDirectDeviceReply(input, latestProfile, resolvedOwnerName);
    } catch {
      return buildDirectDeviceReply(input, profile, ownerName.trim() || ownerNameAutoDetected.trim());
    }
  }

  async function loadPersistedSoakResult() {
    try {
      const response = await LocalLlm.getLastSoakTestResult();
      if (response.exists && response.rawJson) {
        setSoakTestResult(JSON.parse(response.rawJson) as SoakTestResult);
      }
    } catch {
      // Keep diagnostics best-effort.
    }
  }

  async function loadObserverDiagnostics() {
    try {
      const response = await fetch(apiUrl("/api/hive/observer-diagnostics"));
      if (!response.ok) return;
      const data = await response.json();
      setObserverDiagnostics((data?.diagnostics ?? [])[0] ?? null);
    } catch {
      // Keep diagnostics best-effort.
    }
  }

  async function refreshHiveRoutes() {
    try {
      const response = await fetch(apiUrl("/api/hive/network-targets"));
      if (!response.ok) throw new Error(`HIVE discovery returned ${response.status}`);
      const data = await response.json();
      const discoveredRoutes = data?.companion?.routes ?? [];
      const storedHost = readStoredJson<string | null>(HIVE_ROUTE_STORAGE_KEY, null);
      setRoutes(discoveredRoutes);
      setKnownPeers(data?.knownPeers ?? []);
      setObservations(data?.observations ?? []);
      setActiveRoute((current) => {
        if (current) {
          return discoveredRoutes.find((route: HiveRoute) => route.host === current.host) ?? current;
        }
        return discoveredRoutes.find((route: HiveRoute) => route.host === storedHost)
          ?? discoveredRoutes.find((route: HiveRoute) => route.kind === "tailscale")
          ?? discoveredRoutes[0]
          ?? null;
      });
      setHiveError("");
    } catch {
      setRoutes([]);
      setKnownPeers([]);
      setObservations([]);
    }
  }

  async function refreshJobs() {
    try {
      const response = await fetch(apiUrl("/api/companion-node/jobs"));
      if (!response.ok) throw new Error(`Jobs returned ${response.status}`);
      const data = await response.json();
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    }
  }

  function handleLoadState(event: ModelLoadState) {
    setLoadState(event);
    if (event.phase === "loaded") {
      localStorage.setItem(SETUP_STORAGE_KEY, "true");
      setSetupComplete(true);
    }
    if (event.phase === "loaded" || event.phase === "downloaded" || event.phase === "unloaded") {
      void refreshLocalState();
    }
  }

  function clearPrimaryGenerationWatchdog() {
    if (primaryGenerationStateRef.current.idleTimeoutId) {
      clearTimeout(primaryGenerationStateRef.current.idleTimeoutId);
    }
    if (primaryGenerationStateRef.current.hardTimeoutId) {
      clearTimeout(primaryGenerationStateRef.current.hardTimeoutId);
    }
    primaryGenerationStateRef.current = { tokenCount: 0 };
  }

  function completePrimaryGenerationFromWatchdog(reason: "idle" | "timeout") {
    clearPrimaryGenerationWatchdog();
    setIsGenerating(false);
    let recoveredWithText = false;
    let foundStreamingMessage = false;
    setMessages((current) => {
      const streamingMessage = [...current].reverse().find((message) => message.status === "streaming");
      if (!streamingMessage) {
        return current;
      }
      foundStreamingMessage = true;
      recoveredWithText = streamingMessage.text.trim().length > 0;
      return current.map((message) => (
        message.id === streamingMessage.id
          ? {
              ...message,
              status: recoveredWithText ? undefined : "error",
              text: recoveredWithText ? message.text : "Local generation stalled before a reply completed.",
            }
          : message
      ));
    });
    if (!foundStreamingMessage) {
      return;
    }
    setRuntimeError(
      recoveredWithText
        ? "Recovered from a stalled local completion signal."
        : reason === "idle"
          ? "Local generation stalled before any final completion event arrived."
          : "Local generation timed out.",
    );
    void LocalLlm.cancelGeneration({ conversationId: PRIMARY_CONVERSATION_ID }).catch(() => undefined);
  }

  function armPrimaryGenerationWatchdog() {
    clearPrimaryGenerationWatchdog();
    primaryGenerationStateRef.current.hardTimeoutId = setTimeout(() => {
      completePrimaryGenerationFromWatchdog("timeout");
    }, PRIMARY_GENERATION_HARD_TIMEOUT_MS);
    primaryGenerationStateRef.current.idleTimeoutId = setTimeout(() => {
      completePrimaryGenerationFromWatchdog("idle");
    }, PRIMARY_GENERATION_IDLE_TIMEOUT_MS);
  }

  function touchPrimaryGenerationWatchdog() {
    if (!isGenerating && !primaryGenerationStateRef.current.hardTimeoutId) return;
    if (primaryGenerationStateRef.current.idleTimeoutId) {
      clearTimeout(primaryGenerationStateRef.current.idleTimeoutId);
    }
    primaryGenerationStateRef.current.idleTimeoutId = setTimeout(() => {
      completePrimaryGenerationFromWatchdog("idle");
    }, PRIMARY_GENERATION_IDLE_TIMEOUT_MS);
  }

  function handleToken(event: TokenEvent) {
    const waiter = generationWaitersRef.current[event.conversationId];
    if (waiter) {
      waiter.text += event.token;
    }
    if (event.conversationId !== PRIMARY_CONVERSATION_ID) return;
    primaryGenerationStateRef.current.tokenCount += 1;
    touchPrimaryGenerationWatchdog();
    setMessages((current) => current.map((message) => (
      message.status === "streaming"
        ? { ...message, text: message.text + event.token, backendId: event.backendId, modelId: event.modelId }
        : message
    )));
  }

  function handleGenerationDone(event: GenerationDone) {
    const waiter = generationWaitersRef.current[event.conversationId];
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      waiter.resolve(waiter.text);
      delete generationWaitersRef.current[event.conversationId];
    }
    if (event.conversationId !== PRIMARY_CONVERSATION_ID) return;
    clearPrimaryGenerationWatchdog();
    setIsGenerating(false);
    setMessages((current) => current.map((message) => (
      message.status === "streaming"
        ? { ...message, status: undefined, backendId: event.backendId ?? message.backendId, modelId: event.modelId ?? message.modelId }
        : message
    )));
  }

  function handleGenerationCancelled(event: GenerationDone) {
    const waiter = generationWaitersRef.current[event.conversationId];
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error("Generation cancelled."));
      delete generationWaitersRef.current[event.conversationId];
    }
    if (event.conversationId !== PRIMARY_CONVERSATION_ID) return;
    clearPrimaryGenerationWatchdog();
    setIsGenerating(false);
    setMessages((current) => current.map((message) => (
      message.status === "streaming"
        ? { ...message, text: "Generation cancelled.", status: "error" }
        : message
    )));
  }

  function handleRuntimeError(event: RuntimeError) {
    const waiter = event.conversationId ? generationWaitersRef.current[event.conversationId] : undefined;
    if (waiter) {
      clearTimeout(waiter.timeoutId);
      waiter.reject(new Error(event.message));
      delete generationWaitersRef.current[event.conversationId];
    }
    if (event.conversationId === PRIMARY_CONVERSATION_ID) {
      clearPrimaryGenerationWatchdog();
    }
    setIsGenerating(false);
    setRuntimeError(event.message);
    if (event.conversationId === PRIMARY_CONVERSATION_ID) {
      setMessages((current) => current.map((message) => (
        message.status === "streaming"
          ? { ...message, text: event.message, status: "error" }
          : message
      )));
    }
  }

  function handleBackendSwitch(event: { fromBackendId?: BackendId; toBackendId: BackendId; reason: string }) {
    setBackendBanner(`Switched from ${event.fromBackendId ?? "unknown"} to ${event.toBackendId}: ${event.reason}`);
  }

  async function downloadSelectedModel(model = recommendedModel) {
    if (!model) return;
    setRuntimeError("");
    await LocalLlm.downloadModel({ modelId: model.id });
  }

  async function waitForModelLoad(modelId: string, timeoutMs = 180_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const status = await LocalLlm.getRuntimeStatus();
      if (status.loaded && status.activeModelId === modelId) {
        await refreshLocalState();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Timed out waiting for the local model to load.");
  }

  async function loadSelectedModel(model = recommendedModel) {
    if (!model) return;
    setRuntimeError("");
    await LocalLlm.loadModel({ modelId: model.id, backendId: model.backendId });
    await waitForModelLoad(model.id);
  }

  async function sendMessage() {
    const text = prompt.trim();
    if (!text || isGenerating) return;
    const directDeviceReply = await maybeResolveDirectDeviceReply(text);
    if (directDeviceReply) {
      const now = new Date().toISOString();
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        role: "user",
        text,
        timestamp: now,
        backendId: loadedModel?.backendId,
        modelId: loadedModel?.id,
      };
      const assistantMessage: Message = {
        id: `assistant-local-${Date.now()}`,
        role: "assistant",
        text: directDeviceReply,
        timestamp: now,
        backendId: loadedModel?.backendId,
        modelId: loadedModel?.id,
      };
      setPrompt("");
      setRuntimeError("");
      setMessages((current) => [...current, userMessage, assistantMessage]);
      return;
    }
    if (batteryTooLow) return;
    if (!loadedModel) {
      setRuntimeError("Load a local model for open-ended chat. Device questions like time, date, battery, and name can work immediately.");
      return;
    }
    const history = trimTranscript(messages);
    const resolvedOwnerName = ownerName.trim() || ownerNameAutoDetected.trim();
    const deviceContext = buildDeviceContextMessage(profile, resolvedOwnerName, batteryCutoff);
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
      backendId: loadedModel.backendId,
      modelId: loadedModel.id,
    };
    const assistantMessage: Message = {
      id: `assistant-${Date.now()}`,
      role: "assistant",
      text: "",
      timestamp: new Date().toISOString(),
      status: "streaming",
      backendId: loadedModel.backendId,
      modelId: loadedModel.id,
      agentStatus: agentToolsEnabled ? "Thinking..." : undefined,
    };

    setPrompt("");
    setRuntimeError("");
    setIsGenerating(true);
    setMessages((current) => [...current, userMessage, assistantMessage]);

    if (agentToolsEnabled) {
      agentAbortControllerRef.current = new AbortController();
      try {
        const result = await runAgentLoop({
          userMessage: text,
          transcript: history,
          deviceContext,
          allowWebSearch: allowMeteredWebSearch,
          allowPrivateHosts: developerMode,
          signal: agentAbortControllerRef.current.signal,
          device: {
            profile,
            ownerName: resolvedOwnerName,
            batteryCutoff,
          },
          hive: {
            apiBase: API_BASE,
            activeRoute: activeRoute
              ? {
                  host: activeRoute.host,
                  hiveInfoUrl: activeRoute.hiveInfoUrl,
                  ollamaUrl: activeRoute.ollamaUrl,
                }
              : null,
          },
          runTurn: (conversationId, message, transcript, options) => runSingleTurn(
            conversationId,
            message,
            transcript,
            loadedModel,
            options?.temperature,
          ),
          onPartialText: (partialText) => {
            setMessages((current) => current.map((message) => (
              message.id === assistantMessage.id
                ? { ...message, text: partialText, status: "streaming" }
                : message
            )));
          },
          onToolActivity: (entry) => {
            setMessages((current) => current.map((message) => (
              message.id === assistantMessage.id
                ? {
                    ...message,
                    agentStatus: entry.label,
                    toolActivity: [...(message.toolActivity ?? []), entry],
                  }
                : message
            )));
          },
          onStatus: (status) => {
            setMessages((current) => current.map((message) => (
              message.id === assistantMessage.id
                ? { ...message, agentStatus: status, status: "streaming" }
                : message
            )));
          },
        });

        setLastAgentToolTrace(result.toolActivity);
        const finalText = [
          result.fallbackNotice,
          result.finalText,
        ].filter(Boolean).join("\n\n");

        setMessages((current) => current.map((message) => (
          message.id === assistantMessage.id
            ? {
                ...message,
                text: finalText,
                status: undefined,
                agentStatus: undefined,
                toolActivity: result.toolActivity.length ? result.toolActivity : message.toolActivity,
              }
            : message
        )));
      } catch (error: any) {
        const message = error?.message || "Local agent run failed.";
        setRuntimeError(message);
        setMessages((current) => current.map((entry) => (
          entry.id === assistantMessage.id
            ? { ...entry, text: message, status: "error", agentStatus: undefined }
            : entry
        )));
      } finally {
        agentAbortControllerRef.current = null;
        setIsGenerating(false);
      }
      return;
    }

    armPrimaryGenerationWatchdog();
    try {
      await LocalLlm.startGeneration({
        conversationId: PRIMARY_CONVERSATION_ID,
        message: text,
        transcript: deviceContext ? [deviceContext, ...history] : history,
        modelId: loadedModel.id,
        backendId: chooseBackendId(loadedModel.backendId),
        options: { temperature: 0.7, topP: 0.9 },
      });
    } catch (error: any) {
      handleRuntimeError({ conversationId: PRIMARY_CONVERSATION_ID, message: error?.message || "Local inference failed." });
    }
  }

  async function stopGeneration() {
    agentAbortControllerRef.current?.abort();
    const activeConversationIds = Object.keys(generationWaitersRef.current);
    for (const conversationId of activeConversationIds) {
      await LocalLlm.cancelGeneration({ conversationId }).catch(() => undefined);
    }
    await LocalLlm.cancelGeneration({ conversationId: PRIMARY_CONVERSATION_ID }).catch(() => undefined);
    clearPrimaryGenerationWatchdog();
    setIsGenerating(false);
    setMessages((current) => current.map((message) => (
      message.status === "streaming"
        ? { ...message, text: message.text || "Generation cancelled.", status: message.text ? undefined : "error", agentStatus: undefined }
        : message
    )));
  }

  function chooseBackendId(defaultBackendId: BackendId) {
    if (preferredBackendPolicy === "auto") return defaultBackendId;
    return preferredBackendPolicy;
  }

  async function runSingleTurn(
    conversationId: string,
    input: string,
    transcript: LocalTranscriptMessage[],
    model: LocalModelRecord,
    temperature = 0.5,
  ) {
    return new Promise<string>(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        delete generationWaitersRef.current[conversationId];
        reject(new Error("Timed out waiting for a local response."));
      }, 120_000);

      generationWaitersRef.current[conversationId] = { text: "", resolve, reject, timeoutId };

      try {
        await LocalLlm.startGeneration({
          conversationId,
          message: input,
          transcript,
          modelId: model.id,
          backendId: chooseBackendId(model.backendId),
          options: { temperature, topP: 0.9 },
        });
      } catch (error: any) {
        clearTimeout(timeoutId);
        delete generationWaitersRef.current[conversationId];
        reject(new Error(error?.message || "Unable to start local generation."));
      }
    });
  }

  async function runSoakTest(modelId = recommendedModel?.id, backendId?: BackendId) {
    const targetModel = models.find((model) => model.id === modelId) ?? recommendedModel;
    if (!targetModel) {
      setRuntimeError("No local model is available for the soak test.");
      return;
    }
    if (!targetModel.downloaded) {
      setRuntimeError("Download the selected model before running the soak test.");
      return;
    }

    setRuntimeError("");
    setSoakTestRunning(true);
    setBackendBanner("");

    try {
      if (!loadedModel || loadedModel.id !== targetModel.id) {
        await loadSelectedModel(targetModel);
      }

      const transcript: LocalTranscriptMessage[] = [];
      const turns: SoakTestResult["turns"] = [];
      const errors: string[] = [];
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();

      for (let index = 0; index < SOAK_PROMPTS.length; index += 1) {
        const promptText = SOAK_PROMPTS[index];
        const turnStartedMs = Date.now();
        const response = await runSingleTurn(
          `soak-${startedMs}-${index}`,
          promptText,
          transcript,
          loadedModel ?? targetModel,
        );
        turns.push({
          prompt: promptText,
          response,
          durationMs: Date.now() - turnStartedMs,
        });
        transcript.push({ role: "user", text: promptText, timestamp: new Date().toISOString(), backendId: backendId ?? targetModel.backendId, modelId: targetModel.id });
        transcript.push({ role: "assistant", text: response, timestamp: new Date().toISOString(), backendId: backendId ?? targetModel.backendId, modelId: targetModel.id });
      }

      const firstAnswer = turns[0]?.response.trim() ?? "";
      const finalAnswer = turns[turns.length - 1]?.response.trim() ?? "";
      const rememberedFirstAnswer = Boolean(firstAnswer) && normalizeText(finalAnswer).includes(normalizeText(firstAnswer).split(" ")[0] ?? "");

      let agentWebSearchPassed: boolean | undefined;
      let agentWebSearchAnswer: string | undefined;
      if (agentToolsEnabled && allowMeteredWebSearch) {
        try {
          const agentResult = await runAgentLoop({
            userMessage: AGENT_SOAK_PROMPT,
            transcript: [],
            deviceContext: buildDeviceContextMessage(profile, ownerName.trim() || ownerNameAutoDetected.trim(), batteryCutoff),
            allowWebSearch: true,
            allowPrivateHosts: developerMode,
            device: {
              profile,
              ownerName: ownerName.trim() || ownerNameAutoDetected.trim(),
              batteryCutoff,
            },
            hive: {
              apiBase: API_BASE,
              activeRoute: activeRoute
                ? {
                    host: activeRoute.host,
                    hiveInfoUrl: activeRoute.hiveInfoUrl,
                    ollamaUrl: activeRoute.ollamaUrl,
                  }
                : null,
            },
            runTurn: (conversationId, message, transcript, options) => runSingleTurn(
              conversationId,
              message,
              transcript,
              loadedModel ?? targetModel,
              options?.temperature,
            ),
          });
          agentWebSearchAnswer = agentResult.finalText;
          agentWebSearchPassed = /https?:\/\//i.test(agentResult.finalText)
            && agentResult.toolActivity.some((entry) => entry.tool === "web_search" && entry.ok);
        } catch (error: any) {
          errors.push(error?.message || "Agent web-search soak failed.");
          agentWebSearchPassed = false;
        }
      }

      const completedAt = new Date().toISOString();
      const result: SoakTestResult = {
        scriptId: SOAK_SCRIPT_ID,
        passed: rememberedFirstAnswer
          && turns.length === SOAK_PROMPTS.length
          && (agentWebSearchPassed ?? true),
        backendId: backendId ?? targetModel.backendId,
        modelId: targetModel.id,
        startedAt,
        completedAt,
        elapsedMs: Date.now() - startedMs,
        turnCount: turns.length,
        rememberedFirstAnswer,
        firstAnswer,
        finalAnswer,
        failureReason: rememberedFirstAnswer
          ? agentWebSearchPassed === false
            ? "Agent web-search verification failed."
            : undefined
          : "Final answer did not recall the first answer.",
        turns,
        errors,
        agentWebSearchPassed,
        agentWebSearchAnswer,
      };
      setSoakTestResult(result);
      await LocalLlm.saveSoakTestResult({ rawJson: JSON.stringify(result, null, 2) });
    } catch (error: any) {
      const failed: SoakTestResult = {
        scriptId: SOAK_SCRIPT_ID,
        passed: false,
        backendId: backendId ?? targetModel.backendId,
        modelId: targetModel.id,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        elapsedMs: 0,
        turnCount: 0,
        rememberedFirstAnswer: false,
        firstAnswer: "",
        finalAnswer: "",
        failureReason: error?.message || "Soak test failed.",
        turns: [],
        errors: [error?.message || "Soak test failed."],
      };
      setSoakTestResult(failed);
      setRuntimeError(error?.message || "Soak test failed.");
      await LocalLlm.saveSoakTestResult({ rawJson: JSON.stringify(failed, null, 2) }).catch(() => undefined);
    } finally {
      setSoakTestRunning(false);
    }
  }

  async function runHiveProbe(route = activeRoute) {
    if (!route) return;
    setHiveBusy(true);
    setHiveProbe(null);
    setHiveError("");
    try {
      const response = await fetch(apiUrl("/api/hive/test-connection"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: route.host }),
      });
      if (!response.ok) throw new Error(`Probe returned ${response.status}`);
      setHiveProbe(await response.json());
    } catch (error: any) {
      setHiveProbe({
        status: "offline",
        latency: 0,
        endpoints: {
          hiveInfoUrl: route.hiveInfoUrl,
          ollamaTagsUrl: `${route.ollamaUrl}/api/tags`,
          companionUrl: route.companionUrl,
        },
        ollama: { reachable: false, modelCount: 0, models: [] },
        hiveNode: null,
        trustState: route.trustState,
        visibilityState: route.visibilityState,
        serverEnforcementKnown: route.serverEnforcementKnown,
        protocolContext: {
          protocolVersion: "hive-pairing-prep-v1",
          clientRole: "companion_observer",
          trustState: route.trustState,
          capabilityIntent: ["observer"],
          peerId: `peer:${route.host}`,
          nonce: "",
          timestamp: new Date().toISOString(),
          authPresent: false,
          signatureHeader: null,
        },
        testLog: [error?.message || "Unable to probe this route."],
      });
      setHiveError(error?.message || "Unable to probe this route.");
    } finally {
      setHiveBusy(false);
      await refreshHiveRoutes();
    }
  }

  function selectHiveRoute(route: HiveRoute) {
    setActiveRoute(route);
    setHiveProbe(null);
    setHiveError("");
  }

  async function preparePairing(mode: "approved_candidate" | "paired_placeholder", route = activeRoute) {
    if (!route) return;
    setHiveBusy(true);
    setHiveError("");
    try {
      const response = await fetch(apiUrl("/api/hive/prepare-pairing"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          host: route.host,
          kind: route.kind,
          displayName: route.label,
          mode,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Pairing prep returned ${response.status}`);
      }
      await refreshHiveRoutes();
    } catch (error: any) {
      setHiveError(error?.message || "Unable to prepare local pairing intent.");
    } finally {
      setHiveBusy(false);
    }
  }

  async function revokePeer(route = activeRoute) {
    if (!route) return;
    setHiveBusy(true);
    setHiveError("");
    try {
      const response = await fetch(apiUrl("/api/hive/revoke-peer"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: route.host }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Revoke returned ${response.status}`);
      }
      await refreshHiveRoutes();
      setHiveProbe(null);
    } catch (error: any) {
      setHiveError(error?.message || "Unable to revoke this local trust intent.");
    } finally {
      setHiveBusy(false);
    }
  }

  async function runObserverDiagnostics(route = activeRoute) {
    if (!route || !developerMode) return;
    setHiveBusy(true);
    setHiveError("");
    try {
      const response = await fetch(apiUrl("/api/hive/run-observer-diagnostics"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: route.host }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Diagnostics returned ${response.status}`);
      }
      const data = await response.json();
      setObserverDiagnostics(data.diagnostics ?? null);
    } catch (error: any) {
      setHiveError(error?.message || "Unable to run observer diagnostics.");
    } finally {
      setHiveBusy(false);
    }
  }

  useEffect(() => {
    localStorage.setItem(WORKER_MODE_STORAGE_KEY, JSON.stringify(workerModeEnabled));
  }, [workerModeEnabled]);

  useEffect(() => {
    return () => {
      workerAgentRef.current?.stop();
    };
  }, []);

  async function pairWithActiveNode() {
    if (!activeRoute) return;
    setControlBusy(true);
    setControlError("");
    try {
      await pairWithNode(activeRoute.host, profile?.deviceLabel || ownerName.trim() || "Companion");
      await refreshControlStatus();
    } catch (error: any) {
      setControlError(error?.message || "Pairing failed. Enable 'Allow phone pairing' on the desktop node first.");
    } finally {
      setControlBusy(false);
    }
  }

  function unpairActiveNode() {
    if (!activeRoute) return;
    forgetPairedNode(activeRoute.host);
    setControlStatus(null);
    setControlError("");
  }

  async function refreshControlStatus() {
    if (!activeRoute) return;
    try {
      const status = await getControlStatus(activeRoute.host);
      setControlStatus({ nodeName: status.nodeName, models: status.info.Models, lanes: status.info.Lanes });
      setControlError("");
    } catch (error: any) {
      setControlStatus(null);
      setControlError(error?.message || "Unable to read remote node status.");
    }
  }

  async function runCommandOnActiveNode() {
    if (!activeRoute || !remoteCommandSpec.trim()) return;
    setControlBusy(true);
    setControlError("");
    setRemoteCommandResult("");
    try {
      const response = await runRemoteTask(activeRoute.host, remoteCommandSpec.trim());
      setRemoteCommandResult(response.result);
    } catch (error: any) {
      setControlError(error?.message || "Remote command failed.");
    } finally {
      setControlBusy(false);
    }
  }

  function startWorkerAgent() {
    if (!activeRoute || !loadedModel || workerAgentRef.current?.isRunning) return;
    const agent = new HiveWorkerAgentClient({
      warchiefUrl: `http://${activeRoute.host}:7079`,
      workerId: profile?.deviceLabel || ownerName.trim() || "TheOrcCompanion",
      lanes: WORKER_LANES_DEFAULT,
      runInference: async (spec, role) => runSingleTurn(
        `hive-worker-${Date.now()}`,
        spec,
        [],
        loadedModel,
        role === "researcher" ? 0.4 : 0.2,
      ),
      onLog: (message) => setWorkerLog((current) => [message, ...current].slice(0, 20)),
      onStatusChanged: setWorkerAgentRunning,
    });
    workerAgentRef.current = agent;
    agent.start();
  }

  function stopWorkerAgent() {
    workerAgentRef.current?.stop();
    workerAgentRef.current = null;
  }

  function toggleWorkerMode() {
    const next = !workerModeEnabled;
    setWorkerModeEnabled(next);
    if (next) {
      startWorkerAgent();
    } else {
      stopWorkerAgent();
    }
  }

  useEffect(() => {
    if (workerModeEnabled && loadedModel && activeRoute && !workerAgentRef.current?.isRunning) {
      startWorkerAgent();
    }
    if (workerModeEnabled && (!loadedModel || !activeRoute) && workerAgentRef.current?.isRunning) {
      stopWorkerAgent();
    }
  }, [workerModeEnabled, loadedModel, activeRoute]);

  async function submitJob(type: "organize_directory" | "scrape_url") {
    setJobError("");
    try {
      const input = type === "organize_directory"
        ? { rootPath: organizePath, applyChanges: false, maxFiles: 50 }
        : { url: scrapeUrl };
      const response = await fetch(apiUrl("/api/companion-node/jobs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, input }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Job returned ${response.status}`);
      }
      await refreshJobs();
    } catch (error: any) {
      setJobError(error?.message || "Unable to queue job.");
    }
  }

  return (
    <div className="min-h-screen bg-[#030604] text-zinc-100">
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col pb-24">
        <header className="sticky top-0 z-20 border-b border-lime-400/20 bg-[#030604]/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <img src={companionIcon} alt="" className="h-10 w-10 rounded-lg border border-lime-400/40" />
              <div>
                <h1 className="text-base font-black text-white">TheOrc Companion</h1>
                <p className="text-xs text-zinc-400">{connectionLabel} chat node</p>
              </div>
            </div>
            <span className={`rounded-md border px-2 py-1 text-xs font-bold ${loadedModel ? "border-lime-400/50 text-lime-300" : "border-zinc-700 text-zinc-400"}`}>
              {loadedModel?.backend ? `${loadedModel.backend} Ready` : loadedModel ? "Model Ready" : "Setup Needed"}
            </span>
          </div>
        </header>

        <section className="flex-1 px-4 py-4">
          {activeTab === "chat" && (
            <ChatScreen
              nativeAvailable={nativeAvailable}
              setupComplete={setupComplete}
              profile={profile}
              activeBackend={activeBackend}
              model={recommendedModel}
              loadedModel={loadedModel}
              runtimeStatus={runtimeStatus}
              downloadProgress={downloadProgress}
              loadState={loadState}
              runtimeError={runtimeError}
              backendBanner={backendBanner}
              messages={messages}
              prompt={prompt}
              isGenerating={isGenerating}
              batteryTooLow={batteryTooLow}
              contextHealth={contextHealth}
              onPromptChange={setPrompt}
              onDownload={downloadSelectedModel}
              onLoad={loadSelectedModel}
              onSend={sendMessage}
              onStop={stopGeneration}
              onClear={() => setMessages([])}
            />
          )}
          {activeTab === "hive" && (
            <HiveScreen
              routes={routes}
              activeRoute={activeRoute}
              probe={hiveProbe}
              busy={hiveBusy}
              error={hiveError}
              knownPeers={knownPeers}
              observations={observations}
              diagnostics={observerDiagnostics}
              developerMode={developerMode}
              onRefresh={refreshHiveRoutes}
              onSelect={selectHiveRoute}
              onProbe={runHiveProbe}
              onPrepareObserver={() => void preparePairing("approved_candidate")}
              onPreparePairing={() => void preparePairing("paired_placeholder")}
              onRevoke={() => void revokePeer()}
              onRunDiagnostics={() => void runObserverDiagnostics()}
              isPairedWithActiveNode={Boolean(activeRoute && getPairedNode(activeRoute.host))}
              controlBusy={controlBusy}
              controlError={controlError}
              controlStatus={controlStatus}
              onPair={() => void pairWithActiveNode()}
              onUnpair={unpairActiveNode}
              onRefreshControlStatus={() => void refreshControlStatus()}
              remoteCommandSpec={remoteCommandSpec}
              remoteCommandResult={remoteCommandResult}
              onRemoteCommandSpec={setRemoteCommandSpec}
              onRunRemoteCommand={() => void runCommandOnActiveNode()}
              workerModeEnabled={workerModeEnabled}
              workerAgentRunning={workerAgentRunning}
              workerLog={workerLog}
              hasLoadedModel={Boolean(loadedModel)}
              onToggleWorkerMode={toggleWorkerMode}
            />
          )}
          {activeTab === "jobs" && (
            <JobsScreen
              jobs={jobs}
              organizePath={organizePath}
              scrapeUrl={scrapeUrl}
              error={jobError}
              onOrganizePath={setOrganizePath}
              onScrapeUrl={setScrapeUrl}
              onSubmit={submitJob}
              onRefresh={refreshJobs}
            />
          )}
          {activeTab === "settings" && (
            <SettingsScreen
              profile={profile}
              backends={backends}
              models={models}
              batteryCutoff={batteryCutoff}
              ownerName={ownerName}
              ownerNameAutoDetected={ownerNameAutoDetected}
              developerMode={developerMode}
              preferredBackendPolicy={preferredBackendPolicy}
              preferredModelId={preferredModelId}
              activeRoute={activeRoute}
              soakTestRunning={soakTestRunning}
              soakTestResult={soakTestResult}
              agentToolsEnabled={agentToolsEnabled}
              allowMeteredWebSearch={allowMeteredWebSearch}
              onAgentToolsEnabled={setAgentToolsEnabled}
              onAllowMeteredWebSearch={setAllowMeteredWebSearch}
              lastAgentToolTrace={lastAgentToolTrace}
              loadedModelId={loadedModel?.id ?? ""}
              onBatteryCutoff={setBatteryCutoff}
              onOwnerName={setOwnerName}
              onRequestContactsAccess={() => void requestContactsAccess()}
              onDeveloperMode={setDeveloperMode}
              onPreferredBackendPolicy={setPreferredBackendPolicy}
              onPreferredModelId={setPreferredModelId}
              onRefresh={refreshLocalState}
              onRunSoakTest={() => void runSoakTest()}
              onDeleteModel={async (modelId) => {
                await LocalLlm.deleteModel({ modelId });
                await refreshLocalState();
              }}
              onUnload={async () => {
                await LocalLlm.unloadModel();
                await refreshLocalState();
              }}
            />
          )}
        </section>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-lime-400/20 bg-[#020402]/95 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-1 px-3 py-2">
          <NavButton active={activeTab === "chat"} icon={<MessageSquare />} label="Chat" onClick={() => setActiveTab("chat")} />
          <NavButton active={activeTab === "hive"} icon={<Network />} label="Hive" onClick={() => setActiveTab("hive")} />
          <NavButton active={activeTab === "jobs"} icon={<Bot />} label="Jobs" onClick={() => setActiveTab("jobs")} />
          <NavButton active={activeTab === "settings"} icon={<Settings />} label="Settings" onClick={() => setActiveTab("settings")} />
        </div>
      </nav>
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-md text-xs font-bold ${active ? "bg-lime-400 text-black" : "text-zinc-400"}`}
    >
      {React.cloneElement(icon as React.ReactElement, { className: "h-5 w-5" })}
      <span>{label}</span>
    </button>
  );
}

function ChatScreen(props: {
  nativeAvailable: boolean;
  setupComplete: boolean;
  profile: DeviceProfile | null;
  activeBackend: BackendRecord | null;
  model: LocalModelRecord | null;
  loadedModel: LocalModelRecord | null;
  runtimeStatus: RuntimeStatus | null;
  downloadProgress: DownloadProgress | null;
  loadState: ModelLoadState | null;
  runtimeError: string;
  backendBanner: string;
  messages: Message[];
  prompt: string;
  isGenerating: boolean;
  batteryTooLow: boolean;
  contextHealth: string;
  onPromptChange: (value: string) => void;
  onDownload: (model?: LocalModelRecord | null) => void;
  onLoad: (model?: LocalModelRecord | null) => void;
  onSend: () => void;
  onStop: () => void;
  onClear: () => void;
}) {
  const needsSetup = !props.setupComplete || !props.loadedModel;
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const container = messageListRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [props.messages, props.isGenerating]);

  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    composer.style.height = "0px";
    composer.style.height = `${Math.min(composer.scrollHeight, 160)}px`;
  }, [props.prompt]);

  return (
    <div className="flex min-h-[calc(100vh-9rem)] flex-col gap-4">
      {needsSetup && (
        <section className="rounded-md border border-lime-400/30 bg-[#071007] p-4">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-black">Local chat setup</h2>
              <p className="mt-1 text-sm text-zinc-400">Install one local model, load it on-device, and keep every chat on this phone.</p>
            </div>
            <ShieldCheck className="h-6 w-6 text-lime-300" />
          </div>
          <div className="grid gap-2 text-sm">
            <SetupRow label="Device" value={props.profile ? `${props.profile.manufacturer} ${props.profile.model}` : "Checking"} ok={Boolean(props.profile)} />
            <SetupRow label="Native backend" value={props.nativeAvailable ? "Android bridge available" : "Open the Android app"} ok={props.nativeAvailable} />
            <SetupRow label="Storage free" value={props.profile ? formatBytes(props.profile.storageFreeBytes) : "Checking"} ok={(props.profile?.storageFreeBytes ?? 0) > (props.model?.downloadSizeBytes ?? 1)} />
            <SetupRow label="Recommended model" value={props.model?.downloaded ? "Downloaded" : props.model?.name ?? "Checking"} ok={Boolean(props.model?.downloaded)} />
          </div>
          {props.downloadProgress && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-zinc-400">
                <span>Downloading model</span>
                <span>{Math.round(props.downloadProgress.progress * 100)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded bg-zinc-900">
                <div className="h-full bg-lime-400" style={{ width: `${Math.min(100, props.downloadProgress.progress * 100)}%` }} />
              </div>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button onClick={() => props.onDownload(props.model)} disabled={!props.model || props.model.downloaded} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-lime-400 px-3 py-3 text-sm font-black text-black disabled:opacity-40">
              <Download className="h-4 w-4" />
              Download
            </button>
            <button onClick={() => props.onLoad(props.model)} disabled={!props.model?.downloaded} className="flex flex-1 items-center justify-center gap-2 rounded-md border border-lime-400/40 px-3 py-3 text-sm font-black text-lime-200 disabled:opacity-40">
              <Play className="h-4 w-4" />
              Load
            </button>
          </div>
          {props.loadState && <p className="mt-3 text-xs text-zinc-400">Model state: {props.loadState.phase}{props.loadState.backend ? ` (${props.loadState.backend})` : ""}</p>}
        </section>
      )}

      {props.backendBanner && (
        <div className="rounded-md border border-cyan-400/40 bg-cyan-950/20 p-3 text-sm text-cyan-100">{props.backendBanner}</div>
      )}
      {props.runtimeError && (
        <div className="rounded-md border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{props.runtimeError}</div>
      )}
      {props.batteryTooLow && (
        <div className="rounded-md border border-amber-500/40 bg-amber-950/20 p-3 text-sm text-amber-100">Battery is below the local inference cutoff.</div>
      )}

      <div className="grid gap-2 md:grid-cols-4">
        <StatusChip icon={<Cpu className="h-4 w-4" />} label="Backend" value={props.loadedModel?.backend ?? props.activeBackend?.label ?? "Idle"} />
        <StatusChip icon={<Sparkles className="h-4 w-4" />} label="Model" value={props.loadedModel?.name ?? "None"} />
        <StatusChip icon={<Network className="h-4 w-4" />} label="Offline" value={props.loadedModel ? "Ready" : "Waiting"} />
        <StatusChip icon={<ShieldCheck className="h-4 w-4" />} label="Context" value={props.runtimeStatus?.supportsMultiTurn ? `${props.contextHealth} / multi-turn` : `${props.contextHealth} / replayed`} />
      </div>

      <section className="flex flex-1 flex-col rounded-md border border-zinc-800 bg-[#050805]">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <div>
            <span className="text-sm font-bold">{props.loadedModel?.name ?? "No local model loaded"}</span>
            <p className="text-xs text-zinc-500">
              {props.profile?.batteryPercent && props.profile.batteryPercent >= 0
                ? `Battery ${Math.round(props.profile.batteryPercent)}%${props.profile.charging ? " / charging" : ""}`
                : "Battery unknown"}
            </p>
          </div>
          <button onClick={props.onClear} className="rounded-md p-2 text-zinc-400 hover:bg-zinc-900">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <div ref={messageListRef} className="flex min-h-80 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {props.messages.length === 0 ? (
            <div className="m-auto max-w-sm text-center text-sm text-zinc-500">Once the local model is loaded, this becomes a private, persistent, offline chat thread.</div>
          ) : props.messages.map((message) => (
            <article key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-[15px] leading-6 shadow-sm ${message.role === "user" ? "bg-lime-400 text-black" : message.status === "error" ? "border border-red-500/40 bg-red-950/40 text-red-100" : "border border-zinc-800 bg-zinc-950 text-zinc-100"}`}>
                <p className={`mb-2 text-[11px] font-bold uppercase tracking-[0.18em] ${message.role === "user" ? "text-black/60" : "text-zinc-500"}`}>
                  {message.role === "user" ? "You" : message.status === "error" ? "Error" : "Companion"}
                </p>
                <div className="break-words whitespace-pre-wrap">
                  {(message.role === "assistant" ? cleanupAssistantDisplayText(message.text) : message.text) || (message.status === "streaming" ? (message.agentStatus ?? "Thinking...") : "")}
                  {message.status === "streaming" && (
                    <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-lime-300/80 align-middle" />
                  )}
                </div>
                {message.toolActivity && message.toolActivity.length > 0 && (
                  <details className="mt-3 rounded-md border border-zinc-800 bg-black/40 p-2 text-xs text-zinc-400">
                    <summary className="cursor-pointer font-bold text-zinc-300">Tool activity ({message.toolActivity.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {message.toolActivity.map((entry, index) => (
                        <li key={`${entry.tool}-${index}`} className={entry.ok ? "text-lime-300" : "text-red-300"}>
                          {entry.label} · {entry.durationMs}ms{entry.detail ? ` · ${entry.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </article>
          ))}
        </div>
        <div className="flex gap-2 border-t border-zinc-800 p-3">
          <textarea
            ref={composerRef}
            value={props.prompt}
            onChange={(event) => props.onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                props.onSend();
              }
            }}
            disabled={props.isGenerating}
            placeholder={props.loadedModel ? "Ask the local model..." : "Ask about this device, or load a model for full chat"}
            rows={1}
            className="min-h-[52px] max-h-40 min-w-0 flex-1 resize-none rounded-2xl border border-zinc-800 bg-black px-4 py-3 text-[15px] outline-none focus:border-lime-400 disabled:opacity-50"
          />
          {props.isGenerating ? (
            <button onClick={props.onStop} className="rounded-2xl bg-red-500 px-4 text-black">
              <Square className="h-5 w-5" />
            </button>
          ) : (
            <button onClick={props.onSend} disabled={!props.prompt.trim() || props.batteryTooLow} className="rounded-2xl bg-lime-400 px-4 text-black disabled:opacity-40">
              <Send className="h-5 w-5" />
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function StatusChip({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-[#050805] px-3 py-2">
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-zinc-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-sm font-bold text-zinc-100">{value}</div>
    </div>
  );
}

function SetupRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-zinc-800 bg-black/40 px-3 py-2">
      <span className="text-zinc-400">{label}</span>
      <span className={`flex items-center gap-2 text-right font-bold ${ok ? "text-lime-300" : "text-zinc-300"}`}>
        {ok && <CheckCircle2 className="h-4 w-4" />}
        {value}
      </span>
    </div>
  );
}

function HiveScreen({ routes, activeRoute, probe, busy, error, knownPeers, observations, diagnostics, developerMode, onRefresh, onSelect, onProbe, onPrepareObserver, onPreparePairing, onRevoke, onRunDiagnostics, isPairedWithActiveNode, controlBusy, controlError, controlStatus, onPair, onUnpair, onRefreshControlStatus, remoteCommandSpec, remoteCommandResult, onRemoteCommandSpec, onRunRemoteCommand, workerModeEnabled, workerAgentRunning, workerLog, hasLoadedModel, onToggleWorkerMode }: {
  routes: HiveRoute[];
  activeRoute: HiveRoute | null;
  probe: HiveProbeResult | null;
  busy: boolean;
  error: string;
  knownPeers: KnownHivePeer[];
  observations: HiveObservationRecord[];
  diagnostics: HiveObserverDiagnosticsRecord | null;
  developerMode: boolean;
  onRefresh: () => void;
  onSelect: (route: HiveRoute) => void;
  onProbe: (route?: HiveRoute | null) => void;
  onPrepareObserver: () => void;
  onPreparePairing: () => void;
  onRevoke: () => void;
  onRunDiagnostics: () => void;
  isPairedWithActiveNode: boolean;
  controlBusy: boolean;
  controlError: string;
  controlStatus: { nodeName: string; models: string[]; lanes: string[] } | null;
  onPair: () => void;
  onUnpair: () => void;
  onRefreshControlStatus: () => void;
  remoteCommandSpec: string;
  remoteCommandResult: string;
  onRemoteCommandSpec: (value: string) => void;
  onRunRemoteCommand: () => void;
  workerModeEnabled: boolean;
  workerAgentRunning: boolean;
  workerLog: string[];
  hasLoadedModel: boolean;
  onToggleWorkerMode: () => void;
}) {
  const selectedObservation = activeRoute
    ? observations.find((entry) => entry.route.host === activeRoute.host)
    : null;
  const canPrepareObserver = activeRoute?.trustState === "unpaired_observer";
  const canPreparePairing = activeRoute?.trustState === "pairing_ready";
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black">Hive routes</h2>
        <button onClick={onRefresh} className="rounded-md border border-zinc-800 p-2 text-zinc-300"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 text-sm text-amber-100">
        Companion is observer-first here. Visibility over LAN or Tailscale does not equal trust, pairing, or remote enforcement.
      </div>
      {error && <div className="rounded-md border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
      <div className="grid gap-2">
        {routes.length === 0 ? <p className="text-sm text-zinc-500">No desktop HIVE server is reachable from this build right now.</p> : routes.map((route) => (
          <button key={`${route.kind}-${route.host}`} onClick={() => onSelect(route)} className={`rounded-md border p-3 text-left ${activeRoute?.host === route.host ? "border-lime-400 bg-lime-400/10" : "border-zinc-800 bg-[#050805]"}`}>
            <div className="flex items-center justify-between">
              <span className="font-bold">{route.label}</span>
              <span className="text-xs uppercase text-zinc-400">{route.kind}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-400">{route.host}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className={`rounded-full border px-2 py-1 ${route.trustState === "blocked_untrusted" ? "border-red-500/30 text-red-200" : route.trustState === "paired_member_pending_server_enforcement" ? "border-cyan-400/30 text-cyan-200" : route.trustState === "pairing_ready" ? "border-lime-400/30 text-lime-200" : "border-zinc-700 text-zinc-400"}`}>
                {trustStateLabel(route.trustState)}
              </span>
              <span className="rounded-full border border-zinc-700 px-2 py-1 text-zinc-400">
                {route.visibilityState === "approved_locally" ? "Approved locally" : route.visibilityState === "blocked" ? "Blocked locally" : "Visible only"}
              </span>
              <span className={`rounded-full border px-2 py-1 ${route.serverEnforcementKnown ? "border-lime-400/30 text-lime-200" : "border-amber-500/30 text-amber-200"}`}>
                {route.serverEnforcementKnown ? "Server enforced" : "Server unknown"}
              </span>
            </div>
          </button>
        ))}
      </div>
      {activeRoute && (
        <div className="space-y-3 rounded-md border border-zinc-800 bg-[#050805] p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black">{activeRoute.label}</h3>
              <p className="text-xs text-zinc-500">{selectedObservation?.displayName ?? activeRoute.host}</p>
            </div>
            <span className="rounded-full border border-zinc-700 px-2 py-1 text-xs text-zinc-300">{trustStateLabel(activeRoute.trustState)}</span>
          </div>
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <SetupRow label="Visibility" value={selectedObservation?.visibilityState === "approved_locally" ? "Approved locally" : selectedObservation?.visibilityState === "blocked" ? "Blocked locally" : "Observed only"} ok={selectedObservation?.visibilityState === "approved_locally"} />
            <SetupRow label="Remote enforcement" value={activeRoute.serverEnforcementKnown ? "Known" : "Unknown"} ok={activeRoute.serverEnforcementKnown} />
            <SetupRow label="Control surface" value="Disabled" ok={false} />
          </div>
          {!activeRoute.serverEnforcementKnown && (
            <div className="rounded-md border border-amber-500/30 bg-amber-950/20 p-3 text-xs text-amber-100">
              Pairing intent here is local-only. Companion will not claim work, submit results, or auto-enroll until the remote HIVE can verify trust.
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <button onClick={onPrepareObserver} disabled={!canPrepareObserver || busy} className="rounded-md border border-zinc-700 px-3 py-3 text-sm font-bold text-zinc-200 disabled:opacity-40">
              Approve observer
            </button>
            <button onClick={onPreparePairing} disabled={!canPreparePairing || busy} className="rounded-md border border-lime-400/40 px-3 py-3 text-sm font-bold text-lime-200 disabled:opacity-40">
              Prepare pairing
            </button>
            <button onClick={onRevoke} disabled={!activeRoute || busy} className="rounded-md border border-red-500/30 px-3 py-3 text-sm font-bold text-red-200 disabled:opacity-40">
              Block route
            </button>
          </div>
        </div>
      )}

      {activeRoute && (
        <div className="space-y-3 rounded-md border border-cyan-400/30 bg-cyan-950/10 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-cyan-100">Remote control</h3>
              <p className="text-xs text-cyan-200/70">Pair once, then command this node (including the Warchief) directly from the phone.</p>
            </div>
            <span className={`rounded-full border px-2 py-1 text-xs font-bold ${isPairedWithActiveNode ? "border-lime-400/40 text-lime-200" : "border-zinc-700 text-zinc-400"}`}>
              {isPairedWithActiveNode ? "Paired" : "Not paired"}
            </span>
          </div>
          {controlError && <p className="rounded-md border border-red-500/40 bg-red-950/20 p-2 text-xs text-red-200">{controlError}</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {!isPairedWithActiveNode ? (
              <button onClick={onPair} disabled={controlBusy} className="rounded-md border border-cyan-400/40 px-3 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40 sm:col-span-2">
                Pair with this node
              </button>
            ) : (
              <>
                <button onClick={onRefreshControlStatus} disabled={controlBusy} className="rounded-md border border-cyan-400/40 px-3 py-3 text-sm font-bold text-cyan-100 disabled:opacity-40">
                  Refresh status
                </button>
                <button onClick={onUnpair} className="rounded-md border border-red-500/30 px-3 py-3 text-sm font-bold text-red-200">
                  Unpair
                </button>
              </>
            )}
          </div>
          {controlStatus && (
            <div className="rounded-md border border-cyan-400/20 bg-black/30 p-2 text-xs text-cyan-100">
              <p>{controlStatus.nodeName} · models: {controlStatus.models.join(", ") || "none"}</p>
              <p>Lanes: {controlStatus.lanes.join(", ") || "none"}</p>
            </div>
          )}
          {isPairedWithActiveNode && (
            <div className="space-y-2">
              <textarea
                value={remoteCommandSpec}
                onChange={(event) => onRemoteCommandSpec(event.target.value)}
                placeholder="Tell this node what to do (runs directly on its own model, result returned here)"
                rows={2}
                className="w-full resize-none rounded-md border border-cyan-400/30 bg-black px-3 py-2 text-sm text-cyan-50 outline-none"
              />
              <button onClick={onRunRemoteCommand} disabled={controlBusy || !remoteCommandSpec.trim()} className="w-full rounded-md bg-cyan-400 px-3 py-3 text-sm font-black text-black disabled:opacity-40">
                {controlBusy ? "Running on node..." : "Run on this node"}
              </button>
              {remoteCommandResult && (
                <div className="rounded-md border border-cyan-400/20 bg-black/30 p-2 text-xs text-cyan-50 whitespace-pre-wrap">{remoteCommandResult}</div>
              )}
            </div>
          )}
        </div>
      )}

      {activeRoute && (
        <div className="space-y-2 rounded-md border border-lime-400/20 bg-[#050805] p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black">Join as HIVE worker</h3>
              <p className="text-xs text-zinc-500">Polls this node's task queue and executes tasks with this phone's loaded model.</p>
            </div>
            <span className={`rounded-full border px-2 py-1 text-xs font-bold ${workerAgentRunning ? "border-lime-400/40 text-lime-200" : "border-zinc-700 text-zinc-400"}`}>
              {workerAgentRunning ? "Active" : "Idle"}
            </span>
          </div>
          {!hasLoadedModel && <p className="text-xs text-amber-300">Load a local model in Chat setup before joining as a worker.</p>}
          <button onClick={onToggleWorkerMode} disabled={!hasLoadedModel} className={`w-full rounded-md border px-3 py-3 text-sm font-black disabled:opacity-40 ${workerModeEnabled ? "border-lime-400 bg-lime-400 text-black" : "border-zinc-800 text-zinc-300"}`}>
            HIVE worker mode {workerModeEnabled ? "on" : "off"}
          </button>
          {workerLog.length > 0 && (
            <div className="mt-2 space-y-1 text-xs text-zinc-500">
              {workerLog.slice(0, 5).map((line, index) => <p key={index}>{line}</p>)}
            </div>
          )}
        </div>
      )}
      <button onClick={() => onProbe(activeRoute)} disabled={!activeRoute || busy} className="w-full rounded-md bg-lime-400 px-4 py-3 font-black text-black disabled:opacity-40">
        {busy ? "Testing route..." : "Test HIVE Connection"}
      </button>
      {probe && (
        <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
          <div className="flex items-center justify-between">
            <span className="font-bold">Status</span>
            <span className={probe.status === "optimal" ? "text-lime-300" : probe.status === "unstable" ? "text-amber-300" : "text-red-300"}>{probe.status}</span>
          </div>
          <p className="mt-2 text-sm text-zinc-400">Latency: {probe.latency || 0} ms</p>
          <p className="text-sm text-zinc-400">Ollama models: {probe.ollama.modelCount}</p>
          <p className="text-sm text-zinc-400">Trust: {trustStateLabel(probe.trustState)} / protocol {probe.protocolContext.protocolVersion}</p>
          <div className="mt-3 space-y-1 text-xs text-zinc-500">{probe.testLog.map((line, index) => <p key={index}>{line}</p>)}</div>
        </div>
      )}
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <h3 className="text-sm font-black">Known peers</h3>
        <div className="mt-3 space-y-2">
          {knownPeers.length === 0 ? (
            <p className="text-sm text-zinc-500">No local trust records yet.</p>
          ) : knownPeers.map((peer) => (
            <div key={peer.peerId} className="rounded-md border border-zinc-800 bg-black/40 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold">{peer.displayName}</span>
                <span className="text-xs text-zinc-400">{trustStateLabel(peer.trustState)}</span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">Last seen {new Date(peer.lastSeenAt).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
      {developerMode && (
        <div className="rounded-md border border-cyan-400/20 bg-cyan-950/10 p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black text-cyan-100">Observer diagnostics</h3>
              <p className="text-xs text-cyan-200/70">Record what an unpaired sidecar can see and what Companion refuses to do.</p>
            </div>
            <button onClick={onRunDiagnostics} disabled={!activeRoute || busy} className="rounded-md border border-cyan-400/30 px-3 py-2 text-sm font-bold text-cyan-100 disabled:opacity-40">
              Run diagnostics
            </button>
          </div>
          {diagnostics ? (
            <div className="space-y-2 text-sm text-cyan-50">
              <p>Target: {diagnostics.targetHost}</p>
              <p>Exposure: HIVE {diagnostics.metadataExposure.hiveReachable ? "yes" : "no"} / Ollama {diagnostics.metadataExposure.ollamaReachable ? "yes" : "no"} / lanes {diagnostics.metadataExposure.laneCount}</p>
              <p>Refused: {diagnostics.refusedOperations.join(", ")}</p>
            </div>
          ) : (
            <p className="text-sm text-cyan-100/70">No diagnostics run saved yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

function JobsScreen({ jobs, organizePath, scrapeUrl, error, onOrganizePath, onScrapeUrl, onSubmit, onRefresh }: {
  jobs: CompanionJob[];
  organizePath: string;
  scrapeUrl: string;
  error: string;
  onOrganizePath: (value: string) => void;
  onScrapeUrl: (value: string) => void;
  onSubmit: (type: "organize_directory" | "scrape_url") => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black">Edge jobs</h2>
        <button onClick={onRefresh} className="rounded-md border border-zinc-800 p-2 text-zinc-300"><RefreshCw className="h-4 w-4" /></button>
      </div>
      {error && <div className="rounded-md border border-red-500/40 bg-red-950/20 p-3 text-sm text-red-200">{error}</div>}
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <label className="text-sm font-bold">File sort preview</label>
        <div className="mt-2 flex gap-2">
          <input value={organizePath} onChange={(event) => onOrganizePath(event.target.value)} placeholder="F:\\Downloads\\Inbox" className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-black px-3 py-3 text-sm" />
          <button onClick={() => onSubmit("organize_directory")} disabled={!organizePath.trim()} className="rounded-md bg-lime-400 px-3 font-black text-black disabled:opacity-40">Queue</button>
        </div>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <label className="text-sm font-bold">Slow scrape</label>
        <div className="mt-2 flex gap-2">
          <input value={scrapeUrl} onChange={(event) => onScrapeUrl(event.target.value)} placeholder="https://example.com" className="min-w-0 flex-1 rounded-md border border-zinc-800 bg-black px-3 py-3 text-sm" />
          <button onClick={() => onSubmit("scrape_url")} disabled={!scrapeUrl.trim()} className="rounded-md bg-lime-400 px-3 font-black text-black disabled:opacity-40">Queue</button>
        </div>
      </div>
      <div className="space-y-2">
        {jobs.length === 0 ? <p className="text-sm text-zinc-500">No queued jobs yet.</p> : jobs.map((job) => (
          <div key={job.id} className="rounded-md border border-zinc-800 bg-[#050805] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-bold">{job.title}</span>
              <span className="text-xs uppercase text-zinc-400">{job.status}</span>
            </div>
            <p className="mt-1 text-sm text-zinc-500">{job.logicalRole} / {job.executionLane} / {job.capabilityRequired}</p>
            {job.error && <p className="mt-2 text-sm text-red-300">{job.error}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsScreen({ profile, backends, models, batteryCutoff, ownerName, ownerNameAutoDetected, developerMode, preferredBackendPolicy, preferredModelId, activeRoute, soakTestRunning, soakTestResult, agentToolsEnabled, allowMeteredWebSearch, lastAgentToolTrace, loadedModelId, onBatteryCutoff, onOwnerName, onRequestContactsAccess, onDeveloperMode, onPreferredBackendPolicy, onPreferredModelId, onAgentToolsEnabled, onAllowMeteredWebSearch, onRefresh, onRunSoakTest, onDeleteModel, onUnload }: {
  profile: DeviceProfile | null;
  backends: BackendRecord[];
  models: LocalModelRecord[];
  batteryCutoff: number;
  ownerName: string;
  ownerNameAutoDetected: string;
  developerMode: boolean;
  preferredBackendPolicy: BackendPolicy;
  preferredModelId: string;
  activeRoute: HiveRoute | null;
  soakTestRunning: boolean;
  soakTestResult: SoakTestResult | null;
  agentToolsEnabled: boolean;
  allowMeteredWebSearch: boolean;
  lastAgentToolTrace: ToolActivityEntry[];
  loadedModelId: string;
  onBatteryCutoff: (value: number) => void;
  onOwnerName: (value: string) => void;
  onRequestContactsAccess: () => void;
  onDeveloperMode: (value: boolean) => void;
  onPreferredBackendPolicy: (value: BackendPolicy) => void;
  onPreferredModelId: (value: string) => void;
  onAgentToolsEnabled: (value: boolean) => void;
  onAllowMeteredWebSearch: (value: boolean) => void;
  onRefresh: () => void;
  onRunSoakTest: () => void;
  onDeleteModel: (modelId: string) => void;
  onUnload: () => void;
}) {
  const storageUsed = models.reduce((sum, model) => sum + (model.downloaded ? model.bytes : 0), 0);
  const smallModelLoaded = loadedModelId.includes("0.6") || loadedModelId.includes("0_6");
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-black">Settings</h2>
        <button onClick={onRefresh} className="rounded-md border border-zinc-800 p-2 text-zinc-300"><RefreshCw className="h-4 w-4" /></button>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="flex items-center gap-2 text-sm font-bold"><HardDrive className="h-4 w-4 text-lime-300" /> Device</div>
        <p className="mt-2 text-sm text-zinc-400">{profile ? `${profile.manufacturer} ${profile.model}, Android ${profile.androidVersion}` : "Unknown device"}</p>
        <p className="text-sm text-zinc-400">Device name: {profile?.deviceLabel ?? "Unknown"}</p>
        <p className="text-sm text-zinc-400">Local time: {profile?.localTimeIso ?? "Unknown"}</p>
        <p className="text-sm text-zinc-400">Timezone: {profile?.timezoneId ?? "Unknown"}</p>
        <p className="text-sm text-zinc-400">Free storage: {formatBytes(profile?.storageFreeBytes ?? 0)}</p>
        <p className="text-sm text-zinc-400">Model storage: {formatBytes(storageUsed)}</p>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="mb-2 text-sm font-bold">Companion profile</div>
        <p className="mb-3 text-xs text-zinc-500">You can set a local companion name manually, or let Android share your owner/profile contact name if you grant contacts access.</p>
        <p className="mb-3 text-xs text-zinc-400">Detected owner name: {ownerNameAutoDetected || "Not available yet"}</p>
        <input
          value={ownerName}
          onChange={(event) => onOwnerName(event.target.value)}
          placeholder="Your name on this device"
          className="w-full rounded-md border border-zinc-800 bg-black px-3 py-3 text-sm outline-none focus:border-lime-400"
        />
        <button onClick={onRequestContactsAccess} className="mt-3 w-full rounded-md border border-lime-400/40 px-3 py-3 text-sm font-bold text-lime-200">
          Allow contacts/profile access
        </button>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="mb-2 text-sm font-bold">Agent tools</div>
        <p className="mb-3 text-xs text-zinc-500">Local tool calling uses DuckDuckGo HTML search and page fetch on-device. No cloud API keys required.</p>
        <button onClick={() => onAgentToolsEnabled(!agentToolsEnabled)} className={`mb-2 w-full rounded-md border px-3 py-3 text-sm font-black ${agentToolsEnabled ? "border-lime-400 bg-lime-400 text-black" : "border-zinc-800 text-zinc-300"}`}>
          Agent tools {agentToolsEnabled ? "on" : "off"}
        </button>
        <button onClick={() => onAllowMeteredWebSearch(!allowMeteredWebSearch)} disabled={!agentToolsEnabled} className={`w-full rounded-md border px-3 py-3 text-sm font-bold disabled:opacity-40 ${allowMeteredWebSearch ? "border-lime-400/50 text-lime-200" : "border-zinc-800 text-zinc-400"}`}>
          Web search + page fetch {allowMeteredWebSearch ? "allowed" : "blocked"}
        </button>
        {agentToolsEnabled && smallModelLoaded && (
          <p className="mt-3 text-xs text-amber-300">Qwen3 0.6B may struggle with tool JSON. Prefer Qwen2.5 1.5B for agent mode.</p>
        )}
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="mb-2 text-sm font-bold">Backend policy</div>
        <div className="grid grid-cols-3 gap-2">
          {(["auto", "litert", "mlc"] as BackendPolicy[]).map((policy) => (
            <button key={policy} onClick={() => onPreferredBackendPolicy(policy)} className={`rounded-md border px-3 py-2 text-sm font-bold ${preferredBackendPolicy === policy ? "border-lime-400 bg-lime-400 text-black" : "border-zinc-800 text-zinc-300"}`}>
              {policy}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-xs text-zinc-500">
          {backends.map((backend) => (
            <p key={backend.id}>{backend.label}: {backend.available ? "available" : backend.reason ?? "unavailable"}</p>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="mb-2 text-sm font-bold">HIVE posture</div>
        <p className="text-sm text-zinc-400">
          {activeRoute
            ? `${activeRoute.label}: ${trustStateLabel(activeRoute.trustState)} / ${activeRoute.serverEnforcementKnown ? "remote enforcement known" : "remote enforcement unknown"}`
            : "No HIVE route selected yet."}
        </p>
        <p className="mt-1 text-xs text-zinc-500">API base: {API_BASE || "same-origin packaged server"}</p>
        <p className="mt-1 text-xs text-zinc-500">Companion stays observer-first until the remote HIVE can verify trust.</p>
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="flex items-center justify-between text-sm font-bold">
          <span>Battery cutoff</span>
          <span>{batteryCutoff}%</span>
        </div>
        <input type="range" min="5" max="80" step="5" value={batteryCutoff} onChange={(event) => onBatteryCutoff(Number(event.target.value))} className="mt-3 w-full accent-lime-400" />
      </div>
      <div className="rounded-md border border-zinc-800 bg-[#050805] p-3">
        <div className="mb-2 text-sm font-bold">Models</div>
        {models.map((model) => (
          <div key={model.id} className="border-t border-zinc-800 py-3 first:border-t-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold">{model.name}</p>
                <p className="text-xs text-zinc-500">{model.backendId} / {model.downloaded ? formatBytes(model.bytes) : "Not downloaded"} {model.loaded ? "/ loaded" : ""}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onPreferredModelId(model.id)} className={`rounded-md border px-3 py-2 text-xs font-bold ${preferredModelId === model.id ? "border-lime-400 text-lime-300" : "border-zinc-800 text-zinc-400"}`}>
                  Preferred
                </button>
                <button onClick={() => onDeleteModel(model.id)} disabled={!model.downloaded} className="rounded-md border border-zinc-800 p-2 text-zinc-400 disabled:opacity-30">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
        <button onClick={onUnload} className="mt-2 w-full rounded-md border border-zinc-800 px-3 py-2 text-sm font-bold text-zinc-300">Unload model</button>
      </div>
      <button onClick={() => onDeveloperMode(!developerMode)} className={`w-full rounded-md border px-3 py-3 text-sm font-black ${developerMode ? "border-lime-400 bg-lime-400 text-black" : "border-zinc-800 text-zinc-300"}`}>
        Developer mode {developerMode ? "on" : "off"}
      </button>
      {developerMode && (
        <div className="rounded-md border border-lime-400/30 bg-[#071007] p-3">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-black">Diagnostics</h3>
              <p className="text-xs text-zinc-400">Run the 15-turn local memory soak test and keep the last JSON result on-device.</p>
            </div>
            <button onClick={onRunSoakTest} disabled={soakTestRunning} className="rounded-md bg-lime-400 px-3 py-2 text-sm font-black text-black disabled:opacity-40">
              {soakTestRunning ? "Running..." : "Run soak"}
            </button>
          </div>
          {soakTestResult ? (
            <div className="space-y-1 text-sm">
              <p className={soakTestResult.passed ? "text-lime-300" : "text-red-300"}>{soakTestResult.passed ? "Passed" : "Failed"} / {soakTestResult.modelId}</p>
              <p className="text-zinc-400">Turns: {soakTestResult.turnCount} / Recall: {soakTestResult.rememberedFirstAnswer ? "yes" : "no"}</p>
              {soakTestResult.agentWebSearchPassed !== undefined && (
                <p className="text-zinc-400">Agent web search: {soakTestResult.agentWebSearchPassed ? "passed" : "failed"}</p>
              )}
              <p className="text-zinc-500">First answer: {soakTestResult.firstAnswer || "n/a"}</p>
              <p className="text-zinc-500">Final answer: {soakTestResult.finalAnswer || "n/a"}</p>
              {soakTestResult.failureReason && <p className="text-red-300">{soakTestResult.failureReason}</p>}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">No soak test result saved yet.</p>
          )}
          {developerMode && lastAgentToolTrace.length > 0 && (
            <div className="mt-3 border-t border-zinc-800 pt-3 text-xs text-zinc-400">
              <p className="mb-2 font-bold text-zinc-300">Last agent tool trace</p>
              {lastAgentToolTrace.map((entry, index) => (
                <p key={`${entry.tool}-${index}`} className={entry.ok ? "text-lime-300" : "text-red-300"}>
                  {entry.label} · {entry.durationMs}ms
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
