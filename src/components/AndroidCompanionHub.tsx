import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Cpu,
  Database,
  Network,
  RefreshCw,
  Save,
  Shield,
  Wifi,
} from "lucide-react";

interface AndroidCompanionHubProps {
  onAddLog: (message: string, source: "SYSTEM" | "HIVEMIND" | "LOCAL_MODEL" | "SENSORS", level: "info" | "warn" | "success" | "hivemind") => void;
  batteryLevel: number | null;
}

interface CompanionRoute {
  kind: "localhost" | "lan" | "tailscale";
  label: string;
  host: string;
  companionUrl: string;
  hiveInfoUrl: string;
  ollamaUrl: string;
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

interface NetworkTargetsResponse {
  companion: {
    port: number;
    routes: CompanionRoute[];
  };
  tailscale: {
    installed: boolean;
    peers: Array<{
      dnsName: string;
      ip: string;
      online: boolean;
    }>;
  };
  configuredHost: string | null;
  localHive: HiveNodeInfo | null;
  localOllamaReachable: boolean;
}

interface CompanionSetup {
  version: number;
  setupComplete: boolean;
  companionName: string;
  preferredHost: string;
  joinHiveMind: boolean;
  executionTarget: "companion_edge_node";
  enabledCapabilities: Array<"file_sorting" | "file_naming" | "slow_scrape">;
  batteryCutoffPercent: number;
  allowMeteredNetwork: boolean;
}

interface SetupResponse {
  setup: CompanionSetup;
  detection: {
    configuredHost: string | null;
    tailscaleInstalled: boolean;
    tailscalePeerCount: number;
    localHiveReachable: boolean;
    localOllamaReachable: boolean;
    settingsPath: string;
    orcSettingsDetected: boolean;
  };
  installState: {
    completedSteps: number;
    totalSteps: number;
    ready: boolean;
  };
}

interface CompanionJob {
  id: string;
  type: "organize_directory" | "scrape_url";
  title: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  logicalRole: string;
  executionLane: "RESEARCHER" | "CODER" | "UIDEVELOPER" | "TESTER";
  executionTarget: "companion_edge_node";
  capabilityRequired: "file_sorting" | "file_naming" | "slow_scrape";
  input: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
}

interface NodeStatusResponse {
  nodeId: string;
  nodeName: string;
  role: string;
  status: "idle" | "busy";
  setup: CompanionSetup;
  lanes: string[];
  logicalRoles: string[];
  executionTarget: "companion_edge_node";
  capabilities: string[];
  queueDepth: number;
  completedJobs: number;
  failedJobs: number;
  currentJob: CompanionJob | null;
  ollama: {
    reachable: boolean;
    modelCount: number;
  };
  installState: {
    completedSteps: number;
    totalSteps: number;
    ready: boolean;
  };
}

const capabilityMeta = [
  { id: "file_sorting", label: "File Sorting" },
  { id: "file_naming", label: "File Naming" },
  { id: "slow_scrape", label: "Slow Scrape" },
] as const;

export default function AndroidCompanionHub({ onAddLog, batteryLevel }: AndroidCompanionHubProps) {
  const [endpointUrl, setEndpointUrl] = useState("127.0.0.1");
  const [routes, setRoutes] = useState<CompanionRoute[]>([]);
  const [tailscaleInstalled, setTailscaleInstalled] = useState(false);
  const [tailscalePeers, setTailscalePeers] = useState<Array<{ dnsName: string; ip: string; online: boolean }>>([]);
  const [localHive, setLocalHive] = useState<HiveNodeInfo | null>(null);
  const [localOllamaReachable, setLocalOllamaReachable] = useState(false);
  const [activeRoute, setActiveRoute] = useState<CompanionRoute | null>(null);
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [nodeSummary, setNodeSummary] = useState<{
    hiveNode: HiveNodeInfo | null;
    modelCount: number;
    models: string[];
    endpoints: { hiveInfoUrl: string; ollamaTagsUrl: string; companionUrl: string } | null;
  }>({
    hiveNode: null,
    modelCount: 0,
    models: [],
    endpoints: null,
  });
  const [diagResults, setDiagResults] = useState<{
    latency: number;
    jitter: number;
    packetLoss: number;
    bandwidth: number;
    status: "optimal" | "unstable" | "offline" | "untested";
  }>({
    latency: 0,
    jitter: 0,
    packetLoss: 0,
    bandwidth: 0,
    status: "untested",
  });
  const [setup, setSetup] = useState<CompanionSetup | null>(null);
  const [setupDetection, setSetupDetection] = useState<SetupResponse["detection"] | null>(null);
  const [installState, setInstallState] = useState<SetupResponse["installState"] | null>(null);
  const [nodeStatus, setNodeStatus] = useState<NodeStatusResponse | null>(null);
  const [jobs, setJobs] = useState<CompanionJob[]>([]);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [isSubmittingJob, setIsSubmittingJob] = useState(false);
  const [organizePath, setOrganizePath] = useState("");
  const [organizeApplyChanges, setOrganizeApplyChanges] = useState(false);
  const [organizeMaxFiles, setOrganizeMaxFiles] = useState(50);
  const [scrapeUrl, setScrapeUrl] = useState("");

  useEffect(() => {
    onAddLog("Android Companion subsystem ready. Loading HIVE route discovery and edge-node setup profile.", "SYSTEM", "info");
    void refreshAll();

    const intervalId = window.setInterval(() => {
      void loadNodeStatus();
      void loadJobs();
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function refreshAll() {
    await Promise.all([loadNetworkTargets(), loadSetup(), loadNodeStatus(), loadJobs()]);
  }

  async function loadNetworkTargets() {
    try {
      const response = await fetch("/api/hive/network-targets");
      if (!response.ok) {
        throw new Error(`Failed to load targets: ${response.status}`);
      }

      const result: NetworkTargetsResponse = await response.json();
      setRoutes(result.companion.routes);
      setTailscaleInstalled(result.tailscale.installed);
      setTailscalePeers(result.tailscale.peers);
      setLocalHive(result.localHive);
      setLocalOllamaReachable(result.localOllamaReachable);

      const preferredRoute = (result.configuredHost
        ? result.companion.routes.find((route) => route.host === result.configuredHost)
        : null)
        ?? result.companion.routes.find((route) => route.kind === "lan" && !route.host.endsWith(".1"))
        ?? result.companion.routes.find((route) => route.kind === "tailscale")
        ?? result.companion.routes[0]
        ?? null;

      if (preferredRoute) {
        setEndpointUrl((current) => current === "127.0.0.1" ? preferredRoute.host : current);
        setActiveRoute(preferredRoute);
      }

      onAddLog(`Discovered ${result.companion.routes.length} route candidates for Companion/HIVE access.`, "SYSTEM", "info");
    } catch (error: any) {
      onAddLog(`Failed to enumerate local LAN/Tailscale routes: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    }
  }

  async function loadSetup() {
    try {
      const response = await fetch("/api/companion-node/setup");
      if (!response.ok) {
        throw new Error(`Failed to load setup profile: ${response.status}`);
      }

      const result: SetupResponse = await response.json();
      setSetup(result.setup);
      setSetupDetection(result.detection);
      setInstallState(result.installState);
    } catch (error: any) {
      onAddLog(`Failed to read companion setup profile: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    }
  }

  async function loadNodeStatus() {
    try {
      const response = await fetch("/api/companion-node/status");
      if (!response.ok) {
        throw new Error(`Failed to load node status: ${response.status}`);
      }

      const result: NodeStatusResponse = await response.json();
      setNodeStatus(result);
      setInstallState(result.installState);
      setSetup((current) => current ?? result.setup);
    } catch (error: any) {
      onAddLog(`Failed to load companion node status: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    }
  }

  async function loadJobs() {
    try {
      const response = await fetch("/api/companion-node/jobs");
      if (!response.ok) {
        throw new Error(`Failed to load jobs: ${response.status}`);
      }

      const result = await response.json() as { jobs: CompanionJob[] };
      setJobs(result.jobs);
    } catch (error: any) {
      onAddLog(`Failed to load companion jobs: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    }
  }

  function selectRoute(route: CompanionRoute) {
    setActiveRoute(route);
    setEndpointUrl(route.host);
    if (setup) {
      setSetup({ ...setup, preferredHost: route.host });
    }
    onAddLog(`Selected ${route.kind.toUpperCase()} route ${route.host} for Android HIVE probing.`, "SYSTEM", "info");
  }

  async function runConnectionDiagnostics() {
    if (isTestingConn || !endpointUrl.trim()) return;
    setIsTestingConn(true);
    setTestLog([]);
    setNodeSummary({
      hiveNode: null,
      modelCount: 0,
      models: [],
      endpoints: null,
    });
    setDiagResults((prev) => ({ ...prev, status: "untested" }));

    onAddLog(`Probing HIVE node/Ollama endpoints for host ${endpointUrl}...`, "SYSTEM", "info");

    try {
      const response = await fetch("/api/hive/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: endpointUrl }),
      });

      if (!response.ok) {
        throw new Error(`Probe failed with status ${response.status}`);
      }

      const result = await response.json();
      setTestLog(result.testLog || []);
      setDiagResults({
        latency: result.latency || 0,
        jitter: result.jitter || 0,
        packetLoss: result.packetLoss || 0,
        bandwidth: result.bandwidth || 0,
        status: result.status || "offline",
      });
      setNodeSummary({
        hiveNode: result.hiveNode || null,
        modelCount: result.ollama?.modelCount || 0,
        models: result.ollama?.models || [],
        endpoints: result.endpoints || null,
      });

      if (result.status === "optimal") {
        onAddLog(`HIVE link verified on ${result.targetHost}. Node API and Ollama are both reachable.`, "HIVEMIND", "success");
      } else if (result.status === "unstable") {
        onAddLog(`Partial HIVE reachability on ${result.targetHost}. One of the required services is missing.`, "SYSTEM", "warn");
      } else {
        onAddLog(`No HIVE services answered on ${result.targetHost}.`, "SYSTEM", "warn");
      }
    } catch (error: any) {
      setDiagResults({
        latency: 0,
        jitter: 0,
        packetLoss: 100,
        bandwidth: 0,
        status: "offline",
      });
      setTestLog([`Probe failed: ${error?.message || "Unknown error"}`]);
      onAddLog(`Android HIVE probe failed: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    } finally {
      setIsTestingConn(false);
    }
  }

  function toggleCapability(capability: CompanionSetup["enabledCapabilities"][number]) {
    if (!setup) return;
    const hasCapability = setup.enabledCapabilities.includes(capability);
    const nextCapabilities = hasCapability
      ? setup.enabledCapabilities.filter((value) => value !== capability)
      : [...setup.enabledCapabilities, capability];

    setSetup({
      ...setup,
      enabledCapabilities: nextCapabilities,
    });
  }

  async function saveSetupProfile() {
    if (!setup || isSavingSetup) return;
    setIsSavingSetup(true);

    try {
      const response = await fetch("/api/companion-node/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(setup),
      });

      if (!response.ok) {
        throw new Error(`Save failed with status ${response.status}`);
      }

      const result = await response.json() as { setup: CompanionSetup };
      setSetup(result.setup);
      await Promise.all([loadSetup(), loadNodeStatus()]);
      onAddLog(`Saved companion setup for ${result.setup.companionName}.`, "SYSTEM", "success");
    } catch (error: any) {
      onAddLog(`Failed to save companion setup: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    } finally {
      setIsSavingSetup(false);
    }
  }

  async function submitJob(type: "organize_directory" | "scrape_url") {
    if (isSubmittingJob) return;
    setIsSubmittingJob(true);

    try {
      const input = type === "organize_directory"
        ? {
            rootPath: organizePath,
            applyChanges: organizeApplyChanges,
            maxFiles: organizeMaxFiles,
          }
        : {
            url: scrapeUrl,
          };

      const response = await fetch("/api/companion-node/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, input }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || `Job submit failed with status ${response.status}`);
      }

      const result = await response.json() as { job: CompanionJob };
      await Promise.all([loadJobs(), loadNodeStatus()]);
      onAddLog(`Queued ${result.job.executionLane} edge job "${result.job.title}".`, "HIVEMIND", "success");
    } catch (error: any) {
      onAddLog(`Failed to queue companion job: ${error?.message || "unknown error"}`, "SYSTEM", "warn");
    } finally {
      setIsSubmittingJob(false);
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/5 to-transparent blur-xl" />

        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Network Gateway</h2>
            <p className="text-sm font-mono text-slate-400 mt-1">LAN / Tailscale HIVE Link</p>
          </div>
          <Shield className="w-5 h-5 text-indigo-400" />
        </div>

        <div className="space-y-3.5 my-1">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">HIVE Node Host / IP</label>
            <input
              type="text"
              value={endpointUrl}
              onChange={(e) => setEndpointUrl(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-800 tracking-tight font-mono transition"
            />
            <span className="text-[9px] text-slate-500 font-mono">
              Probe target for TheOrc HIVE node API on `7078` and Ollama on `11434`.
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <div className="flex flex-wrap gap-2">
              {routes.map((route) => (
                <button
                  key={`${route.kind}-${route.host}`}
                  onClick={() => selectRoute(route)}
                  className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-mono font-bold transition ${
                    activeRoute?.host === route.host
                      ? "border-indigo-500 bg-indigo-950/20 text-indigo-300"
                      : "border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {route.kind === "tailscale" ? "TS" : route.kind === "lan" ? "LAN" : "LOCAL"} {route.host}
                </button>
              ))}
            </div>

            {routes.length > 0 && activeRoute && (
              <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 text-[10px] font-mono text-slate-400 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-500 uppercase tracking-wider">Phone Access Route</span>
                  <span className="text-indigo-300 font-bold">{activeRoute.label}</span>
                </div>
                <div className="text-slate-300 break-all">Companion UI: {activeRoute.companionUrl}</div>
                <div className="text-slate-500 break-all">HIVE info: {activeRoute.hiveInfoUrl}</div>
                <div className="text-slate-500 break-all">Ollama: {activeRoute.ollamaUrl}</div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-850 pt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-400 font-mono">
            <div className="bg-slate-950 border border-slate-850 rounded-lg p-2.5">
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Local HIVE Node</span>
              <span className={localHive ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {localHive ? `${localHive.Name} online` : "Not detected on this PC"}
              </span>
            </div>

            <div className="bg-slate-950 border border-slate-850 rounded-lg p-2.5">
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Tailscale</span>
              <span className={tailscaleInstalled ? "text-indigo-300 font-bold" : "text-slate-500 font-bold"}>
                {tailscaleInstalled ? `${tailscalePeers.filter((peer) => peer.online).length} online peer(s)` : "CLI not detected"}
              </span>
            </div>

            <div className="bg-slate-950 border border-slate-850 rounded-lg p-2.5">
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Local Ollama</span>
              <span className={localOllamaReachable ? "text-emerald-400 font-bold" : "text-rose-400 font-bold"}>
                {localOllamaReachable ? "Reachable on 11434" : "Not responding on 11434"}
              </span>
            </div>

            <div className="bg-slate-950 border border-slate-850 rounded-lg p-2.5">
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Battery Gate</span>
              <span className={batteryLevel !== null && batteryLevel > 0.2 ? "text-slate-300 font-bold" : "text-amber-400 font-bold"}>
                {batteryLevel !== null ? `${Math.round(batteryLevel * 100)}% phone battery` : "Battery unknown"}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 flex flex-col gap-2 font-mono">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5 text-indigo-400" />
              DIAGNOSTICS STATS
            </span>
            <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${
              diagResults.status === "optimal" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-900/30" :
              diagResults.status === "untested" ? "bg-slate-900 text-slate-500/70 border border-slate-850" :
              "bg-indigo-950/20 text-indigo-400"
            }`}>
              {diagResults.status.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center border-t border-slate-900 pt-2 text-[10px] font-mono">
            <div>
              <span className="text-slate-500 text-[8px] block">LATENCY</span>
              <span className="text-slate-300 font-bold">{diagResults.latency ? `${diagResults.latency} ms` : "-"}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[8px] block">JITTER</span>
              <span className="text-slate-300 font-bold">{diagResults.jitter ? `${diagResults.jitter} ms` : "-"}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[8px] block">PACKET LOSS</span>
              <span className="text-slate-300 font-bold">{diagResults.latency ? `${diagResults.packetLoss}%` : "-"}</span>
            </div>
            <div>
              <span className="text-slate-500 text-[8px] block">BANDWIDTH</span>
              <span className="text-indigo-400 font-bold">{diagResults.latency ? `${diagResults.bandwidth}MB/s` : "-"}</span>
            </div>
          </div>

          {testLog.length > 0 && (
            <div className="border-t border-slate-900 pt-2 text-[9px] text-slate-400 space-y-1 max-h-24 overflow-y-auto pr-1">
              {testLog.map((line, idx) => (
                <div key={idx} className="leading-normal italic text-slate-500">{line}</div>
              ))}
            </div>
          )}

          {nodeSummary.endpoints && (
            <div className="border-t border-slate-900 pt-2 text-[9px] text-slate-400 space-y-1">
              <div className="flex items-center gap-1.5 text-indigo-300 font-bold">
                <Database className="w-3 h-3" />
                <span>Probe Summary</span>
              </div>
              <div className="text-slate-300 break-all">Companion: {nodeSummary.endpoints.companionUrl}</div>
              <div className="text-slate-500 break-all">HIVE: {nodeSummary.endpoints.hiveInfoUrl}</div>
              <div className="text-slate-500 break-all">Ollama: {nodeSummary.endpoints.ollamaTagsUrl}</div>
              {nodeSummary.hiveNode && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <div>
                    <span className="text-slate-500 block">NODE</span>
                    <span className="text-slate-300 font-bold">{nodeSummary.hiveNode.Name}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">MODELS</span>
                    <span className="text-slate-300 font-bold">{nodeSummary.modelCount}</span>
                  </div>
                </div>
              )}
              {nodeSummary.hiveNode?.Lanes?.length ? (
                <div className="flex flex-wrap gap-1 pt-1">
                  {nodeSummary.hiveNode.Lanes.map((lane) => (
                    <span key={lane} className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[8px] text-emerald-300 uppercase">
                      {lane}
                    </span>
                  ))}
                </div>
              ) : null}
              {nodeSummary.models.length > 0 && (
                <div className="text-slate-500 leading-relaxed">
                  {nodeSummary.models.join(" • ")}
                </div>
              )}
            </div>
          )}

          <button
            onClick={runConnectionDiagnostics}
            disabled={isTestingConn}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 font-sans font-bold text-[10px] uppercase cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            {isTestingConn ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Probing LAN / Tailscale Route...</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Test HIVE Connection</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-emerald-500/5 to-transparent blur-xl" />

        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Companion Node</h2>
            <p className="text-sm font-mono text-slate-400 mt-1">First Run Setup + Edge Work Queue</p>
          </div>
          <Cpu className="w-5 h-5 text-emerald-400" />
        </div>

        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-slate-500 uppercase tracking-wider">Install Progress</span>
            <span className={installState?.ready ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
              {installState ? `${installState.completedSteps}/${installState.totalSteps} ready` : "Loading"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[9px] uppercase">Orc Settings</span>
              <span className={setupDetection?.orcSettingsDetected ? "text-emerald-400 font-bold" : "text-slate-500 font-bold"}>
                {setupDetection?.configuredHost || "Not detected"}
              </span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[9px] uppercase">Tailscale Peers</span>
              <span className={setupDetection?.tailscaleInstalled ? "text-indigo-300 font-bold" : "text-slate-500 font-bold"}>
                {setupDetection?.tailscaleInstalled ? `${setupDetection.tailscalePeerCount} online` : "Not detected"}
              </span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[9px] uppercase">Local HIVE</span>
              <span className={setupDetection?.localHiveReachable ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {setupDetection?.localHiveReachable ? "7078 responding" : "7078 not responding"}
              </span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2.5">
              <span className="text-slate-500 block text-[9px] uppercase">Local Ollama</span>
              <span className={setupDetection?.localOllamaReachable ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                {setupDetection?.localOllamaReachable ? "11434 responding" : "11434 not responding"}
              </span>
            </div>
          </div>

          {setup && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Companion Name</label>
                  <input
                    type="text"
                    value={setup.companionName}
                    onChange={(e) => setSetup({ ...setup, companionName: e.target.value })}
                    className="mt-1 w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Preferred Orc Host</label>
                  <input
                    type="text"
                    value={setup.preferredHost}
                    onChange={(e) => setSetup({ ...setup, preferredHost: e.target.value })}
                    className="mt-1 w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                <button
                  onClick={() => setSetup({ ...setup, joinHiveMind: !setup.joinHiveMind })}
                  className={`rounded-lg border px-3 py-2 text-left ${
                    setup.joinHiveMind ? "border-emerald-800 bg-emerald-950/20 text-emerald-300" : "border-slate-800 bg-slate-900 text-slate-500"
                  }`}
                >
                  Join HIVE MIND
                </button>
                <button
                  onClick={() => setSetup({ ...setup, allowMeteredNetwork: !setup.allowMeteredNetwork })}
                  className={`rounded-lg border px-3 py-2 text-left ${
                    setup.allowMeteredNetwork ? "border-indigo-800 bg-indigo-950/20 text-indigo-300" : "border-slate-800 bg-slate-900 text-slate-500"
                  }`}
                >
                  Allow Metered Network
                </button>
              </div>

              <div>
                <div className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider mb-2">Companion Capabilities</div>
                <div className="flex flex-wrap gap-2">
                  {capabilityMeta.map((capability) => {
                    const enabled = setup.enabledCapabilities.includes(capability.id);
                    return (
                      <button
                        key={capability.id}
                        onClick={() => toggleCapability(capability.id)}
                        className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-mono font-bold transition ${
                          enabled
                            ? "border-emerald-800 bg-emerald-950/20 text-emerald-300"
                            : "border-slate-800 bg-slate-900 text-slate-500"
                        }`}
                      >
                        {capability.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <span className="text-slate-500 uppercase tracking-wider">Battery Cutoff</span>
                  <span className="text-emerald-300 font-bold">{setup.batteryCutoffPercent}%</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="80"
                  step="5"
                  value={setup.batteryCutoffPercent}
                  onChange={(e) => setSetup({ ...setup, batteryCutoffPercent: Number(e.target.value) })}
                  className="mt-2 w-full accent-emerald-500"
                />
              </div>

              <button
                onClick={() => setSetup({ ...setup, setupComplete: !setup.setupComplete })}
                className={`w-full rounded-lg border px-3 py-2 text-[10px] font-mono font-bold transition ${
                  setup.setupComplete ? "border-emerald-800 bg-emerald-950/20 text-emerald-300" : "border-slate-800 bg-slate-900 text-slate-400"
                }`}
              >
                {setup.setupComplete ? "Marked As First-Run Complete" : "Mark First-Run Complete"}
              </button>

              <button
                onClick={saveSetupProfile}
                disabled={isSavingSetup}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2 font-sans font-bold text-[10px] uppercase cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-40"
              >
                {isSavingSetup ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>Save Setup Profile</span>
              </button>
            </div>
          )}
        </div>

        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 font-mono flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              EDGE WORK QUEUE
            </span>
            <span className="text-[9px] text-slate-500 font-mono">
              {nodeStatus ? `${nodeStatus.status.toUpperCase()} • ${nodeStatus.queueDepth} pending` : "Loading"}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-mono">
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 block text-[8px]">LANES</span>
              <span className="text-slate-300 font-bold">{nodeStatus?.lanes.length ?? 0}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 block text-[8px]">MODELS</span>
              <span className="text-slate-300 font-bold">{nodeStatus?.ollama.modelCount ?? 0}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 block text-[8px]">DONE</span>
              <span className="text-emerald-300 font-bold">{nodeStatus?.completedJobs ?? 0}</span>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-lg p-2">
              <span className="text-slate-500 block text-[8px]">FAILED</span>
              <span className="text-rose-300 font-bold">{nodeStatus?.failedJobs ?? 0}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3">
            <div className="border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Organize Directory</div>
              <input
                type="text"
                placeholder="F:\\Downloads\\Inbox"
                value={organizePath}
                onChange={(e) => setOrganizePath(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={organizeMaxFiles}
                  onChange={(e) => setOrganizeMaxFiles(Number(e.target.value))}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
                />
                <button
                  onClick={() => setOrganizeApplyChanges((value) => !value)}
                  className={`rounded-lg border px-3 py-2 text-[10px] font-mono font-bold ${
                    organizeApplyChanges ? "border-amber-800 bg-amber-950/20 text-amber-300" : "border-slate-800 bg-slate-900 text-slate-500"
                  }`}
                >
                  {organizeApplyChanges ? "Apply Moves" : "Preview Only"}
                </button>
              </div>
              <button
                onClick={() => void submitJob("organize_directory")}
                disabled={isSubmittingJob || !organizePath.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg py-2 font-sans font-bold text-[10px] uppercase disabled:opacity-40"
              >
                Queue File Sort / Naming
              </button>
            </div>

            <div className="border border-slate-800 rounded-lg p-3 space-y-2">
              <div className="text-[10px] font-mono font-bold text-slate-400 uppercase">Slow Research Scrape</div>
              <input
                type="text"
                placeholder="https://example.com"
                value={scrapeUrl}
                onChange={(e) => setScrapeUrl(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono"
              />
              <button
                onClick={() => void submitJob("scrape_url")}
                disabled={isSubmittingJob || !scrapeUrl.trim()}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 font-sans font-bold text-[10px] uppercase disabled:opacity-40"
              >
                Queue Researcher Scrape
              </button>
            </div>
          </div>

          <div className="border-t border-slate-900 pt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
            {jobs.length === 0 ? (
              <div className="text-[10px] text-slate-500 font-mono italic">No companion jobs queued yet.</div>
            ) : jobs.map((job) => (
              <div key={job.id} className="border border-slate-800 rounded-lg p-2.5 text-[10px] font-mono bg-slate-900/70">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-200 font-bold">{job.title}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    job.status === "completed" ? "bg-emerald-950/20 text-emerald-300" :
                    job.status === "failed" ? "bg-rose-950/20 text-rose-300" :
                    job.status === "running" ? "bg-indigo-950/20 text-indigo-300" :
                    "bg-slate-800 text-slate-400"
                  }`}>
                    {job.status.toUpperCase()}
                  </span>
                </div>
                <div className="mt-1 text-slate-500">
                  {job.logicalRole} {"->"} {job.executionLane} {"->"} {job.executionTarget}
                </div>
                <div className="text-slate-500">Capability: {job.capabilityRequired}</div>
                {job.error ? <div className="text-rose-300 mt-1">{job.error}</div> : null}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
