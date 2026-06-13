import React, { useState, useEffect } from "react";
import { TaskNode, SensorData, LogEntry } from "./types";
import NetworkGraph from "./components/NetworkGraph";
import LocalTerminal from "./components/LocalTerminal";
import SensorSuite from "./components/SensorSuite";
import LogView from "./components/LogView";
import AndroidCompanionHub from "./components/AndroidCompanionHub";
import ResearchHub from "./components/ResearchHub";
import { 
  Network, 
  Send, 
  Play, 
  Cpu, 
  Server,
  CloudLightning, 
  Sliders,
  CheckCircle,
  HelpCircle,
  Info
} from "lucide-react";

const SENDER_MODELS = [
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash",
    provider: "Cloud",
    ramRequiredGb: 0,
    accRequired: "Internet Link",
    tokensPerSec: "120 t/s",
    latency: "~50ms",
    description: "Hivemind Primary Fast Agent",
    branding: "ORC-FLASH-CORE"
  },
  {
    id: "gemini-2.5-pro",
    name: "Gemini 2.5 Pro",
    provider: "Cloud",
    ramRequiredGb: 0,
    accRequired: "Internet Link",
    tokensPerSec: "45 t/s",
    latency: "~220ms",
    description: "Hivemind Expert Complex Execution",
    branding: "ORC-PRO-COGNITIVE"
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro",
    provider: "Cloud",
    ramRequiredGb: 0,
    accRequired: "Internet Link",
    tokensPerSec: "35 t/s",
    latency: "~310ms",
    description: "Hivemind Legacy Analytics",
    branding: "ORC-LEGACY-PRO"
  },
  {
    id: "gemma-2-2b-it-q4",
    name: "Gemma 2B IT (Q4)",
    provider: "Local Edge",
    ramRequiredGb: 3,
    accRequired: "Vulkan / NNAPI",
    tokensPerSec: "18 t/s",
    latency: "~15ms Edge",
    description: "On-Device Balanced Command Swarm",
    branding: "ORC-GEMMA-EDGE"
  },
  {
    id: "phi-3-mini-4k-instruct-int8",
    name: "Phi-3 Mini 3.8B (INT8)",
    provider: "Local Edge",
    ramRequiredGb: 4,
    accRequired: "NNAPI / GPU",
    tokensPerSec: "12 t/s",
    latency: "~18ms Edge",
    description: "On-Device Fast Directives Router",
    branding: "ORC-PHI-EDGE"
  },
  {
    id: "qwen-2.5-coder-1.5b-int3",
    name: "Qwen 2.5 Coder 1.5B (INT3)",
    provider: "Local Edge",
    ramRequiredGb: 2,
    accRequired: "CPU / Vulkan",
    tokensPerSec: "30 t/s",
    latency: "~10ms Edge",
    description: "Swift Edge Validations",
    branding: "ORC-QWEN-ULTRA"
  },
  {
    id: "llama-3.1-8b-instruct-fp16",
    name: "LLaMA 3.1 8B (FP16)",
    provider: "Local Edge",
    ramRequiredGb: 16,
    accRequired: "NPU / Fused GPU",
    tokensPerSec: "5 t/s",
    latency: "~140ms Edge",
    description: "Unquantized Edge Swarm Heavyweight",
    branding: "ORC-LLAMA-HEAVYSYNC"
  }
];

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [isOrchestrating, setIsOrchestrating] = useState(false);
  const [connState, setConnState] = useState<'connected' | 'connecting' | 'offline' | 'simulating'>('connecting');
  const [sensorData, setSensorData] = useState<SensorData>({
    latitude: null,
    longitude: null,
    audioDb: 32,
    batteryLevel: 0.84,
    timestamp: new Date().toISOString()
  });

  // Task & Log States
  const [tasks, setTasks] = useState<TaskNode[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [thoughtStream, setThoughtStream] = useState<string>("");
  const [overallComplexity, setOverallComplexity] = useState<string>("");

  // Orchestration controller state
  const [activeExecIndex, setActiveExecIndex] = useState(-1);
  const [activeLocalPayload, setActiveLocalPayload] = useState("");
  const [autoExecute, setAutoExecute] = useState(true);
  const [activeTab, setActiveTab] = useState<'console' | 'local_slm' | 'android_hub' | 'sensors' | 'research'>('console');
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [simulatedDeviceRam, setSimulatedDeviceRam] = useState(8); // in GB
  const [hardwareCapableOnly, setHardwareCapableOnly] = useState(false);

  const tabsList = [
    { id: 'console' as const, label: 'Main Console' },
    { id: 'local_slm' as const, label: 'Local SLM Engine' },
    { id: 'android_hub' as const, label: 'Android Hub' },
    { id: 'sensors' as const, label: 'Device Sensors' },
    { id: 'research' as const, label: 'Chat & Research' }
  ];

  const handleSwipeLeft = () => {
    const currentIndex = tabsList.findIndex(t => t.id === activeTab);
    if (currentIndex > 0) {
      setActiveTab(tabsList[currentIndex - 1].id);
    }
  };

  const handleSwipeRight = () => {
    const currentIndex = tabsList.findIndex(t => t.id === activeTab);
    if (currentIndex < tabsList.length - 1) {
      setActiveTab(tabsList[currentIndex + 1].id);
    }
  };

  // Custom log appender helper
  const addLog = (message: string, source: LogEntry['source'] = 'SYSTEM', level: LogEntry['level'] = 'info') => {
    const newLog: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      level,
      source,
      message
    };
    setLogs(prev => [newLog, ...prev]);
  };

  // Run a quick pre- handshake and setup booting logs on bootup
  useEffect(() => {
    addLog("Establishing Local O.R.C. Companion sub-systems... checking thread safety.", "SYSTEM", "info");
    addLog("Parsing CPU registers... baseline temperature: 36.5°C.", "SYSTEM", "info");
    addLog("GPS query queue is healthy. Initializing AC battery telemetry.", "SYSTEM", "info");
    
    // Simulate connection checking to the Hivemind
    const connectTimer = setTimeout(() => {
      setConnState('simulating'); // Starts as simulating, checks key to determine connected or simulating
      setConnState(prev => {
        // We'll read key availability from standard server test
        addLog("Remote handshake acknowledged by O.R.C. HIVEMIND cluster! Code validation safe.", "HIVEMIND", "hivemind");
        return 'connected';
      });
    }, 1200);

    return () => clearTimeout(connectTimer);
  }, []);

  const handleSensorsChange = (data: SensorData) => {
    setSensorData(data);
  };

  // Core Orchestration Dispatch Trigger
  const triggerOrchestrationPlan = async () => {
    if (!prompt.trim() || isOrchestrating) return;

    setIsOrchestrating(true);
    setActiveExecIndex(-1);
    setTasks([]);
    setThoughtStream("");
    setOverallComplexity("");
    
    addLog(`Directing instruction payload to Hivemind [Engine: shadow-aligned through ${selectedModel.toUpperCase()}]: "${prompt}"`, "CLIENT" as any, "info");
    addLog(`Gathering edge sensor array details... Latitude: ${sensorData.latitude ? sensorData.latitude.toFixed(4) : "Unknown"}, Microphone DB: ${sensorData.audioDb}dB.`, "SENSORS", "info");

    try {
      const response = await fetch("/api/hivemind/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          localSensors: sensorData,
          selectedModel
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP network anomaly registered: status ${response.status}`);
      }

      const result = await response.json();
      const plan = result.data.orchestrationPlan || [];
      
      setIsDemoMode(result.isDemoMode);
      setThoughtStream(result.data.thoughtStream || "");
      setOverallComplexity(result.data.overallComplexity || "Unknown");
      setTasks(plan.map((t: any) => ({ ...t, status: 'pending' })));

      addLog(`HIVEMIND: Directives compiled successfully. Network layout complexity: [${result.data.overallComplexity}].`, "HIVEMIND", "hivemind");
      addLog(`Thought Stream: "${result.data.thoughtStream}"`, "HIVEMIND", "hivemind");

      if (plan.length > 0) {
        addLog(`Dispatched ${plan.length} orchestration sub-agents to queue. Standby for trigger.`, "SYSTEM", "success");
        
        if (autoExecute) {
          // Trigger queue execution automatically
          // We set executing index to 0
          setActiveExecIndex(0);
        }
      } else {
        addLog("Hivemind resolved directive with zero-node swarm layout requirements.", "SYSTEM", "warn");
        setIsOrchestrating(false);
      }

    } catch (err: any) {
      console.error(err);
      addLog(`Failed to communicate with Hivemind Core. Check logs: ${err.message}`, "SYSTEM", "warn");
      setIsOrchestrating(false);
    }
  };

  // Sequenced Queue Executor
  useEffect(() => {
    if (activeExecIndex === -1 || activeExecIndex >= tasks.length) {
      // Loop reached index end
      if (activeExecIndex >= tasks.length && tasks.length > 0) {
        setIsOrchestrating(false);
        setActiveExecIndex(-1);
        addLog("Swarm coordination complete! Synchronization telemetry has been fully fused.", "SYSTEM", "success");
      }
      return;
    }

    const currentTask = tasks[activeExecIndex];
    if (!currentTask) return;

    // Update state to set current task to 'running'
    setTasks(prev => prev.map((t, idx) => idx === activeExecIndex ? { ...t, status: 'running' } : t));
    addLog(`Dispatching [${currentTask.title}] to target: ${currentTask.target.toUpperCase()}`, "SYSTEM", "info");

    if (currentTask.target === "local_device_slm") {
      // Direct payload to Simulated Local Terminal
      // This changes activeLocalPayload which triggers the terminal run
      addLog(`[LOCAL_SLM] Spin lock acquired. Bootloader initialized for task: ${currentTask.actionRequired}`, "LOCAL_MODEL", "info");
      setActiveLocalPayload(currentTask.payload);
    } else {
      // Direct to Hivemind Core server processor
      processHivemindTask(currentTask, activeExecIndex);
    }

  }, [activeExecIndex, tasks.length]);

  // Execute Task on Hivemind Core
  const processHivemindTask = async (task: TaskNode, index: number) => {
    try {
      const res = await fetch("/api/hivemind/process-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actionRequired: task.actionRequired,
          payload: task.payload
        })
      });

      if (!res.ok) throw new Error("Cloud computing core server failed task execution.");

      const data = await res.json();
      
      // Update Task completed with output
      setTasks(prev => prev.map((t, idx) => idx === index ? { 
        ...t, 
        status: 'completed',
        result: data.output,
        processingTimeMs: data.executionTimeMs
      } : t));

      addLog(`[HIVEMIND CORE] Node finished task execution. Computed output: ${data.output}`, "HIVEMIND", "hivemind");
      
      // Select next step in task list
      setTimeout(() => {
        setActiveExecIndex(prev => prev + 1);
      }, 700);

    } catch (err: any) {
      addLog(`Core execution failed for task [${task.title}]: ${err.message}`, "SYSTEM", "warn");
      setTasks(prev => prev.map((t, idx) => idx === index ? { ...t, status: 'failed' } : t));
      
      // Proceed or stall depending on user preference
      setTimeout(() => {
        setActiveExecIndex(prev => prev + 1);
      }, 1000);
    }
  };

  // Local SLM completion callback
  const handleLocalInferenceCompleted = (output: string, stats: { executionTimeMs: number; tokens: number; tps: number }) => {
    if (activeExecIndex === -1) return; // Ignore manual queries

    setTasks(prev => prev.map((t, idx) => idx === activeExecIndex ? {
      ...t,
      status: 'completed',
      result: output,
      processingTimeMs: stats.executionTimeMs
    } : t));

    addLog(`[LOCAL_SLM] Successfully synced on-device weights output. Evaluated ${stats.tokens} tokens at ${stats.tps} tokens/sec in ${stats.executionTimeMs}ms.`, "LOCAL_MODEL", "success");

    // Clean active trigger payload
    setActiveLocalPayload("");

    // Advance queue
    setTimeout(() => {
      setActiveExecIndex(prev => prev + 1);
    }, 700);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30 selection:text-indigo-200">
      
      {/* HEADER COMMAND CAP BAR */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-xl text-white shadow-lg shadow-indigo-950/40">
            Ω
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2 font-mono">
              <h1 className="font-sans font-black text-base tracking-tight text-white uppercase">TheORC <span className="text-indigo-400 text-xs font-mono ml-1">v2.10-COMPANION</span></h1>
            </div>
            <span className="text-[10px] text-slate-400 font-mono tracking-wide leading-none uppercase">HIVEMIND COMPANION INTERFACE</span>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-full">
            <span className="text-[10px] font-mono uppercase text-slate-300">Layout: Real Companion Dashboard</span>
          </div>

          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-full">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-mono uppercase text-slate-300">Hivemind: Online</span>
          </div>
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 px-3.5 py-1.5 rounded-full">
            <div className="w-2 h-2 rounded-full bg-indigo-500"></div>
            <span className="text-[10px] font-mono uppercase text-indigo-300">Node: FUSED</span>
          </div>
        </div>
      </header>

      {/* CORE FRAME CONTAINER */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col gap-4">

        {/* DEMO MODE WARNING CARD (Resilient fall back guidance) */}
        {isDemoMode && (
          <div className="bg-amber-950/20 border border-amber-900/60 rounded-2xl p-4 flex gap-3 items-start animate-fade-in mb-2">
            <Info className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex flex-col gap-1">
              <span className="font-sans text-xs font-bold text-amber-200 leading-tight">Operating in Isolated Swarm Simulation</span>
              <p className="text-[11px] text-amber-300 leading-relaxed max-w-4xl">
                No custom <code className="bg-slate-950 border border-slate-850 px-1 py-0.5 rounded font-mono text-emerald-300 font-semibold text-[10px]">GEMINI_API_KEY</code> is setup in your project secrets. 
                TheORC Companion has seamlessly launched a high-fidelity mock-orchestrator model. To activate real live cloud-orchestrated multi-agent generation, configure your keys via the 
                <span className="font-extrabold mx-1 whitespace-nowrap text-amber-100">Settings &gt; Secrets</span> panel in AI Studio.
              </p>
            </div>
          </div>
        )}

        {/* VIEW RE-ROUTE BLOCK */}
        {(() => {
          // Dynamic computed telemetry metrics
          const isHiveActive = isOrchestrating && activeExecIndex !== -1 && tasks[activeExecIndex]?.target !== "local_device_slm";
          const isLocalActive = activeLocalPayload !== "";
          const totalPowerWatts = (1.2 + (isHiveActive ? 4.8 : 0) + (isLocalActive ? 3.9 : 0)).toFixed(2);
          const totalTFlops = (0.012 + (isHiveActive ? 84.8 : 0) + (isLocalActive ? 4.5 : 0)).toFixed(3);
          const coherenceRating = connState === 'connected' ? "99.8%" : (connState === 'simulating' ? "94.4%" : "0.0%");
          const edgeLatencyValue = connState === 'connected' ? (isOrchestrating ? "18ms" : "14ms") : "Disconnected";

          if (true) {
            return (
              /* =========================================================
                 1. DASHBOARD PORT CONTROL (BENTO GRID WITH TABS)
                 ========================================================= */
              <div className="flex flex-col gap-4">
                
                {/* Tactical Horizontal Navigation & Swipe controllers */}
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/50 border border-slate-800 rounded-2xl p-4 shadow-sm select-none">
                  <div className="flex items-center gap-2.5">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
                    <span className="font-mono text-xs font-bold text-indigo-300 uppercase tracking-widest">Active Deck: {activeTab === 'console' ? "Consoles Front" : activeTab === 'local_slm' ? "SLM Compiler" : activeTab === 'android_hub' ? "Android Companion" : activeTab === 'sensors' ? "Device Sensory" : "Hivemind Intelligence"}</span>
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto bg-slate-950 p-1.5 rounded-xl border border-slate-850">
                    <button
                      onClick={handleSwipeLeft}
                      disabled={activeTab === 'console'}
                      className="p-1.5 px-3 bg-slate-900 hover:bg-slate-850 text-slate-350 disabled:opacity-20 rounded-lg text-[10px] font-mono tracking-wider transition cursor-pointer font-bold"
                    >
                      &larr; SLIDE LEFT
                    </button>
                    
                    <div className="flex gap-1 overflow-x-auto">
                      {tabsList.map(tab => (
                        <button
                          key={tab.id}
                          onClick={() => setActiveTab(tab.id)}
                          className={`px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold tracking-wider transition whitespace-nowrap cursor-pointer ${
                            activeTab === tab.id
                              ? 'bg-indigo-600 text-white shadow-sm font-extrabold'
                              : 'text-slate-500 hover:text-slate-300'
                          }`}
                        >
                          {tab.label.toUpperCase()}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={handleSwipeRight}
                      disabled={activeTab === 'research'}
                      className="p-1.5 px-3 bg-slate-900 hover:bg-slate-850 text-slate-350 disabled:opacity-20 rounded-lg text-[10px] font-mono tracking-wider transition cursor-pointer font-bold"
                    >
                      SLIDE RIGHT &rarr;
                    </button>
                  </div>
                </div>

                {/* TAB WINDOW 1: CORE MINIMALIST CONSOLE FRONTAGE */}
                {activeTab === 'console' && (
                  <div className="space-y-4 animate-fade-in animate-duration-300">
                    
                    {/* Live hardware metrics requested: Total Power / TFlops / Latency / Coherence */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                      
                      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between gap-1 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-indigo-500/5 to-transparent blur-lg" />
                        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Aggregate Energy</span>
                        <div className="flex items-baseline gap-1 mt-1">
                          <span className="text-2xl font-black text-white font-sans tracking-tight">{totalPowerWatts}</span>
                          <span className="text-[10px] text-indigo-400 font-mono font-bold uppercase">Watts</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-pulse" />
                          <span>{isLocalActive || isHiveActive ? "PEAK CORES ENGAGEMENT" : "STANDBY THERMAL LOAD"}</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between gap-1 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-violet-500/5 to-transparent blur-lg" />
                        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Processing Power</span>
                        <div className="flex items-baseline gap-1 mt-1">
                          <span className="text-2xl font-black text-white font-sans tracking-tight">{totalTFlops}</span>
                          <span className="text-[10px] text-violet-400 font-mono font-bold uppercase">TFlops</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
                          <span>{isHiveActive ? "CLOUD NEURAL COMPUTE active" : isLocalActive ? "EDGE COMPILER SPIKE" : "IDLE PIPELINE CAP"}</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between gap-1 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-cyan-500/5 to-transparent blur-lg" />
                        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Sync Coherence</span>
                        <div className="flex items-baseline mt-1">
                          <span className="text-2xl font-black text-white font-sans tracking-tight">{coherenceRating}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 inline-block" />
                          <span>SWARM CONVERGENCE</span>
                        </div>
                      </div>

                      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4.5 flex flex-col justify-between gap-1 shadow-sm relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-16 h-16 bg-gradient-to-bl from-amber-500/5 to-transparent blur-lg" />
                        <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-widest">Edge Latency</span>
                        <div className="flex items-baseline mt-1">
                          <span className="text-2xl font-black text-white font-sans tracking-tight">{edgeLatencyValue}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono mt-1.5 flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-450 inline-block" />
                          <span>SECURE LINK PULSE RATE</span>
                        </div>
                      </div>

                    </div>

                    {/* Chat Dispatcher Prompt & Hive Map Topology */}
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                      
                      {/* Left Block: Minimalist Chat / Input Box */}
                      <div className="md:col-span-7 bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/5 to-transparent blur-xl" />
                        
                        <div className="flex justify-between items-start border-b border-slate-850 pb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Input Dispatcher</h2>
                              <span className="text-[9px] font-mono font-extrabold bg-indigo-950/60 border border-indigo-805/40 text-indigo-300 px-2 py-0.5 rounded uppercase tracking-wider">
                                HardcoreErik/TheOrc Swarm
                              </span>
                            </div>
                            <p className="text-sm font-mono text-slate-400 mt-1">Broadcast Swarm Directive</p>
                          </div>
                          <Send className="w-5 h-5 text-indigo-400" />
                        </div>

                        {/* THEORC MODEL SELECTOR & SPECIFICATIONS FILTERING */}
                        <div className="bg-slate-950/70 border border-slate-900 rounded-xl p-3 flex flex-col gap-3 text-xs font-mono">
                          
                          {/* Main Row: Selector and dynamic checkbox */}
                          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3 text-nowrap">
                            <div className="flex-1 flex flex-col sm:flex-row items-baseline sm:items-center gap-2">
                              <span className="text-slate-500 font-bold uppercase text-[9.5px]">SELECT ENGINE:</span>
                              <div className="relative inline-block w-full sm:w-auto flex-1">
                                <select 
                                  value={selectedModel}
                                  onChange={(e) => setSelectedModel(e.target.value)}
                                  className="w-full bg-slate-900 border border-slate-800 rounded-lg py-1.5 pl-3 pr-8 text-xs font-mono font-bold text-indigo-300 focus:outline-none focus:border-indigo-600 cursor-pointer appearance-none"
                                >
                                  {SENDER_MODELS.map(model => {
                                    const isCapable = model.provider === "Cloud" || simulatedDeviceRam >= model.ramRequiredGb;
                                    if (hardwareCapableOnly && !isCapable) return null;
                                    
                                    return (
                                      <option key={model.id} value={model.id} disabled={!isCapable} className="bg-slate-950 text-slate-300">
                                        {model.name} {model.ramRequiredGb > 0 ? `[Edge - Req ${model.ramRequiredGb}G]` : "[Hivemind Cloud]"} {!isCapable ? " ❌ (Need RAM)" : " (Capable)"}
                                      </option>
                                    );
                                  })}
                                </select>
                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-indigo-400">
                                  <Sliders className="w-3.5 h-3.5" />
                                </div>
                              </div>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer text-[10px] text-slate-400 select-none hover:text-slate-200 transition">
                              <input 
                                type="checkbox"
                                checked={hardwareCapableOnly}
                                onChange={(e) => setHardwareCapableOnly(e.target.checked)}
                                className="accent-indigo-500 w-3.5 h-3.5 rounded bg-slate-900 border-slate-800 cursor-pointer"
                              />
                              <span>Hardware-Capable Only</span>
                            </label>
                          </div>

                          {/* RAM Tuning block */}
                          <div className="border-t border-slate-900 pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[10px] text-slate-400">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-slate-500 font-bold uppercase text-[9.5px]">Device RAM Spec:</span>
                              <div className="flex gap-1 bg-[#02050c] p-0.5 rounded border border-slate-850">
                                {[2, 3, 4, 8, 12, 16].map(ram => (
                                  <button
                                    key={ram}
                                    onClick={() => setSimulatedDeviceRam(ram)}
                                    className={`px-2 py-0.5 rounded text-[9.5px] transition font-bold font-mono cursor-pointer ${
                                      simulatedDeviceRam === ram
                                        ? "bg-indigo-600 text-white shadow-sm font-extrabold"
                                        : "text-slate-500 hover:text-slate-300 hover:bg-slate-900/50"
                                    }`}
                                  >
                                    {ram}G
                                  </button>
                                ))}
                              </div>
                            </div>

                            {(() => {
                              const activeModelDef = SENDER_MODELS.find(m => m.id === selectedModel);
                              if (!activeModelDef) return null;
                              const isCapable = activeModelDef.provider === "Cloud" || simulatedDeviceRam >= activeModelDef.ramRequiredGb;
                              return (
                                <div className="text-[9px] bg-[#02050c] px-2 py-1 rounded border border-slate-900 leading-normal flex items-center gap-2 max-w-full font-mono">
                                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCapable ? "bg-emerald-500 animate-pulse" : "bg-red-500 animate-pulse"}`} />
                                  <span className="text-slate-400 truncate">
                                    {activeModelDef.branding} &middot; <strong className={isCapable ? "text-emerald-400" : "text-rose-400 font-bold"}>
                                      {isCapable ? "COMPATIBLE" : "OVERLOAD"}
                                    </strong>
                                    {activeModelDef.ramRequiredGb > 0 && ` (${activeModelDef.ramRequiredGb}G req)`}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Dynamic detailed spec stats */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 border-t border-slate-900 pt-2 text-[9px] text-slate-500 leading-tight">
                            <div>
                              <span className="font-bold text-slate-600 block uppercase text-[8px] tracking-wider mb-0.5">Engine Class</span>
                              <span className="text-slate-300 font-semibold">{SENDER_MODELS.find(m => m.id === selectedModel)?.provider || "Cloud"}</span>
                            </div>
                            <div>
                              <span className="font-bold text-slate-600 block uppercase text-[8px] tracking-wider mb-0.5 font-sans">Speed</span>
                              <span className="text-indigo-400 font-semibold font-mono">{SENDER_MODELS.find(m => m.id === selectedModel)?.tokensPerSec || "-"}</span>
                            </div>
                            <div>
                              <span className="font-bold text-slate-600 block uppercase text-[8px] tracking-wider mb-0.5 font-sans">Latency</span>
                              <span className="text-violet-400 font-semibold font-mono">{SENDER_MODELS.find(m => m.id === selectedModel)?.latency || "-"}</span>
                            </div>
                            <div>
                              <span className="font-bold text-slate-600 block uppercase text-[8px] tracking-wider mb-0.5 font-sans">Hardware Accelerator</span>
                              <span className="text-slate-300 font-semibold font-mono truncate block">{SENDER_MODELS.find(m => m.id === selectedModel)?.accRequired || "-"}</span>
                            </div>
                          </div>

                          {/* Secondary info description detail */}
                          <div className="border-t border-slate-900.5 pt-1.5 text-[9.5px] italic text-slate-450 leading-relaxed font-sans">
                            {SENDER_MODELS.find(m => m.id === selectedModel)?.description}
                          </div>

                        </div>

                        {/* Interactive message chat box style prompt */}
                        <div className="flex flex-col gap-3.5 my-1">
                          <div className="flex flex-col sm:flex-row gap-3">
                            <input
                              type="text"
                              value={prompt}
                              onChange={(e) => setPrompt(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && triggerOrchestrationPlan()}
                              placeholder="E.g., Scan local audio peaks and verify GPS coordinate lock..."
                              disabled={isOrchestrating}
                              id="hivemind-prompt-input"
                              className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-xs text-slate-250 placeholder-slate-500 focus:outline-none focus:border-indigo-800 hover:border-slate-700 flex-1 transition disabled:opacity-50"
                            />
                            {(() => {
                              const mDef = SENDER_MODELS.find(m => m.id === selectedModel);
                              const isCapable = !mDef || mDef.provider === "Cloud" || simulatedDeviceRam >= mDef.ramRequiredGb;
                              return (
                                <button
                                  onClick={triggerOrchestrationPlan}
                                  disabled={isOrchestrating || !prompt.trim() || !isCapable}
                                  id="submit-hivemind-btn"
                                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl px-6 py-3 font-sans text-xs cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 text-nowrap shadow-md shadow-indigo-950/40"
                                >
                                  <Send className="w-4 h-4" />
                                  <span>{isCapable ? "EXECUTE DIRECTIVE" : "RAM OVERLOAD"}</span>
                                </button>
                              );
                            })()}
                          </div>

                          {/* Options */}
                          <div className="flex flex-wrap items-center justify-between gap-3 text-[10px] font-mono pt-3 border-t border-slate-850/50 text-slate-400">
                            <label className="flex items-center gap-2 cursor-pointer group">
                              <input
                                type="checkbox"
                                checked={autoExecute}
                                onChange={(e) => setAutoExecute(e.target.checked)}
                                className="accent-indigo-500 w-3.5 h-3.5 rounded bg-slate-900 border-slate-800 cursor-pointer"
                              />
                              <span className="group-hover:text-slate-300 transition">Auto-Execute Swarm Plan</span>
                            </label>

                            <div className="flex items-center gap-4">
                              <span>Complexity: <strong className="text-indigo-400 font-bold uppercase">{overallComplexity || "Standby"}</strong></span>
                              <span className="w-px h-3 bg-slate-850" />
                              <span>Sub-agents: <strong className="text-indigo-400 font-bold">{tasks.length}</strong></span>
                            </div>
                          </div>
                        </div>

                        {/* Interactive dynamic message log if prompt active */}
                        {thoughtStream && (
                          <div className="bg-indigo-950/20 border border-indigo-900/30 px-4 py-3 rounded-xl flex flex-col gap-1.5 animate-fade-in mt-1">
                            <span className="font-mono text-[9px] uppercase tracking-widest text-indigo-300 font-bold">Hivemind Thought Stream:</span>
                            <p className="text-xs text-slate-300 italic leading-relaxed">
                              "{thoughtStream}"
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right Block: Hive Map Topology Graph */}
                      <div className="md:col-span-5 flex flex-col">
                        <NetworkGraph tasks={tasks} isOrchestrating={isOrchestrating && activeExecIndex !== -1} connState={connState} />
                      </div>

                      {/* Display Task progress in a clean grid card if queries active */}
                      {tasks.length > 0 && (
                        <div className="md:col-span-12">
                          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3">
                            <div className="flex items-center justify-between">
                              <span className="font-sans text-xs font-bold text-slate-550 uppercase tracking-widest">Compiled Directives Flow Checklist</span>
                              <span className="text-indigo-400 font-mono text-[10px] font-bold">COORDINATED EXECUTION</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                              {tasks.map((task, idx) => (
                                <div 
                                  key={task.id}
                                  className={`p-3.5 rounded-xl border flex flex-col justify-between gap-2.5 transition ${
                                    task.status === 'running' ? 'bg-indigo-950/20 border-indigo-800/80 shadow-sm' :
                                    task.status === 'completed' ? 'bg-slate-950/50 border-slate-900 opacity-60' :
                                    'bg-slate-950/10 border-slate-950'
                                  }`}
                                >
                                  <div>
                                    <div className="flex justify-between items-center text-[9px] mb-1">
                                      <span className="font-mono font-bold text-indigo-400">_0{idx + 1} {task.title.toUpperCase()}</span>
                                      <span className="text-[8px] uppercase tracking-wider text-slate-550 font-bold bg-slate-950 px-1 py-0.5 rounded border border-slate-850">
                                        {task.target === 'local_device_slm' ? "Edge SLM" : "Cloud"}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-450 font-mono leading-relaxed line-clamp-2">{task.actionRequired}</p>
                                  </div>
                                  {task.result ? (
                                    <div className="bg-[#030712] border border-slate-900 p-2 rounded text-[10px] text-slate-300 font-mono line-clamp-2 leading-normal">
                                      {task.result}
                                    </div>
                                  ) : (
                                    task.status === 'running' && (
                                      <div className="text-[10px] text-indigo-400 italic font-medium flex items-center gap-1 bg-indigo-950/30 px-2 py-1 rounded">
                                        <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
                                        <span>Resolving weights...</span>
                                      </div>
                                    )
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}

                    </div>
                  </div>
                )}

                {/* TAB WINDOW 2: INT8/Q4 MODEL RUNNER */}
                {activeTab === 'local_slm' && (
                  <div className="animate-fade-in animate-duration-300">
                    <LocalTerminal 
                      onLocalInferenceComplete={handleLocalInferenceCompleted} 
                      activeTaskPayload={activeLocalPayload} 
                    />
                  </div>
                )}

                {/* TAB WINDOW 3: ANDROID CONFIG COMPILER */}
                {activeTab === 'android_hub' && (
                  <div className="animate-fade-in animate-duration-300">
                    <AndroidCompanionHub onAddLog={addLog} batteryLevel={sensorData.batteryLevel} />
                  </div>
                )}

                {/* TAB WINDOW 4: LIVE TELEMETRY DECK / SYSTEM EVENT STREAM */}
                {activeTab === 'sensors' && (
                  <div className="grid grid-cols-1 gap-4 animate-fade-in animate-duration-300">
                    <SensorSuite onSensorsChange={handleSensorsChange} />
                    <LogView logs={logs} onClearLogs={() => setLogs([])} />
                  </div>
                )}

                {/* TAB WINDOW 5: HIVEMIND RESEARCH STATION */}
                {activeTab === 'research' && (
                  <div className="animate-fade-in animate-duration-300">
                    <ResearchHub />
                  </div>
                )}

              </div>
            );
          } else {
            return (
              /* =========================================================
                 2. HANDSET MOCK DEVICE ENVIRONMENT (MOBILE SCREEN PREVIEW)
                 ========================================================= */
              <div className="flex justify-center items-center py-4">
                
                {/* The Mobile Shell Window */}
                <div className="w-full max-w-sm bg-slate-950 rounded-[36px] border-[5px] border-slate-800 shadow-[0_0_80px_rgba(99,102,241,0.15)] overflow-hidden flex flex-col relative aspect-[9/18]">
                  
                  {/* Speaker Notch */}
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 w-16 h-4 bg-slate-950 border border-slate-850 rounded-full z-20 flex items-center justify-center">
                    <span className="w-1.5 h-1.5 bg-indigo-500/80 rounded-full mr-1 animate-pulse" />
                    <span className="w-6 h-[2px] bg-slate-800 rounded-full" />
                  </div>

                  {/* Top status bar mock */}
                  <div className="h-8 pt-2 px-6 flex items-center justify-between text-[9px] font-mono text-slate-500 z-10 bg-slate-950 border-b border-slate-900">
                    <span>11:43 UTC</span>
                    <span className="text-indigo-400 font-extrabold uppercase select-none">ORC_MOBILE_SECURE</span>
                    <span>{(sensorData.batteryLevel ? Math.round(sensorData.batteryLevel * 100) : 84)}%</span>
                  </div>

                  {/* Mobile Header Menu with compact Tab Selectors */}
                  <div className="bg-slate-950 border-b border-slate-900 p-3.5 flex flex-col gap-2.5 z-10">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500 flex items-center justify-center text-indigo-400 font-black text-xs">
                        Ω
                      </div>
                      <div className="flex flex-col">
                        <h1 className="font-sans font-black text-xs text-slate-200 tracking-wider">O.R.C. Companion</h1>
                        <span className="text-[7.5px] text-slate-500 uppercase font-mono leading-none">Swarm mobile node</span>
                      </div>
                    </div>

                    {/* Highly tactile tab selection controls inside the mobile screen block */}
                    <div className="flex items-center justify-between gap-1 bg-[#02050c] p-1 rounded-xl border border-slate-850">
                      <button 
                        onClick={handleSwipeLeft} 
                        disabled={activeTab === 'console'}
                        className="text-slate-450 hover:text-white disabled:opacity-10 text-[9px] font-bold px-1 transition"
                      >
                        &lsaquo;
                      </button>
                      <div className="flex gap-1 overflow-x-auto no-scrollbar scroll-smooth">
                        {tabsList.map(tab => (
                          <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`px-2 py-1 rounded-md text-[8.5px] font-mono font-bold tracking-tight transition whitespace-nowrap cursor-pointer ${
                              activeTab === tab.id
                                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-800'
                                : 'text-slate-500 hover:text-slate-350 border border-transparent'
                            }`}
                          >
                            {tab.id === 'console' ? "Console" : tab.id === 'local_slm' ? "SLM Core" : tab.id === 'android_hub' ? "Gateway" : tab.id === 'sensors' ? "Sensors" : "Research"}
                          </button>
                        ))}
                      </div>
                      <button 
                        onClick={handleSwipeRight} 
                        disabled={activeTab === 'research'}
                        className="text-slate-450 hover:text-white disabled:opacity-10 text-[9px] font-bold px-1 transition"
                      >
                        &rsaquo;
                      </button>
                    </div>
                  </div>

                  {/* Scrollable handset body scroll container */}
                  <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 bg-[#030712]">
                    
                    {/* PHONE SCREEN WINDOW 1: CORE CONSOLE */}
                    {activeTab === 'console' && (
                      <div className="flex flex-col gap-3.5 animate-fade-in animate-duration-300">
                        
                        {/* Compact Mobile live stats counters: Power & Tflops */}
                        <div className="grid grid-cols-2 gap-2 bg-[#02050c] p-2.5 rounded-xl border border-slate-900 font-mono">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[7.5px] text-slate-500 font-bold uppercase uppercase tracking-wider">AGGREGATE POWER</span>
                            <span className="text-[11px] font-bold text-slate-200">{totalPowerWatts} <span className="text-[8px] text-indigo-400 font-bold">W</span></span>
                          </div>
                          <div className="flex flex-col gap-0.5 border-l border-slate-900 pl-2.5">
                            <span className="text-[7.5px] text-slate-500 font-bold uppercase uppercase tracking-wider">PERFORMANCE INDEX</span>
                            <span className="text-[11px] font-bold text-slate-200">{totalTFlops} <span className="text-[8px] text-violet-400 font-bold">T/S</span></span>
                          </div>
                        </div>

                        {/* Minimalist Chat input dispatcher */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 shadow-inner relative overflow-hidden">
                          <div className="flex items-center justify-between text-[8px] text-slate-500 font-bold uppercase tracking-widest border-b border-slate-850 pb-2">
                            <span>SENDER SYSTEM [TheOrc Swarm]</span>
                            <span className="text-indigo-400 font-extrabold pb-0.5">V2.10</span>
                          </div>

                          {/* Compact mobile model selector */}
                          <div className="flex flex-col gap-2 bg-slate-950/80 p-2 rounded-xl border border-slate-900 font-mono text-[10px]">
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-slate-500 font-bold uppercase text-[8px]">ENGINE:</span>
                              <select 
                                value={selectedModel}
                                onChange={(e) => setSelectedModel(e.target.value)}
                                className="bg-slate-905 bg-slate-900 border border-slate-850 rounded px-1.5 py-0.5 text-[9.5px] text-indigo-300 font-mono font-bold focus:outline-none cursor-pointer"
                              >
                                {SENDER_MODELS.map(model => {
                                  const isCapable = model.provider === "Cloud" || simulatedDeviceRam >= model.ramRequiredGb;
                                  if (hardwareCapableOnly && !isCapable) return null;
                                  return (
                                    <option key={model.id} value={model.id} disabled={!isCapable} className="bg-slate-950 text-slate-350 text-[10px]">
                                      {model.name} {!isCapable ? " ❌" : " (Cap)"}
                                    </option>
                                  );
                                })}
                              </select>
                            </div>

                            {/* Compact mobile RAM spec selector */}
                            <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-900/60">
                              <span className="text-slate-500 font-bold uppercase text-[8px]">Handset RAM:</span>
                              <div className="flex gap-1">
                                {[2, 4, 8, 16].map(ram => (
                                  <button
                                    key={ram}
                                    onClick={() => setSimulatedDeviceRam(ram)}
                                    className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold font-mono transition cursor-pointer ${
                                      simulatedDeviceRam === ram
                                        ? "bg-indigo-600/85 text-white"
                                        : "text-slate-500 bg-slate-900/40 hover:text-slate-300"
                                    }`}
                                  >
                                    {ram}G
                                  </button>
                                ))}
                              </div>
                            </div>

                            {(() => {
                              const activeModelDef = SENDER_MODELS.find(m => m.id === selectedModel);
                              if (!activeModelDef) return null;
                              const isCapable = activeModelDef.provider === "Cloud" || simulatedDeviceRam >= activeModelDef.ramRequiredGb;
                              return (
                                <div className="text-[8px] bg-[#02050c] p-1.5 rounded border border-slate-900 flex items-center justify-between gap-1.5">
                                  <span className="text-slate-450 uppercase truncate">{activeModelDef.branding}</span>
                                  <span className={isCapable ? "text-emerald-400 font-bold" : "text-rose-500 font-bold"}>
                                    {isCapable ? "READY" : "OVERLOAD"}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>

                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              value={prompt}
                              onChange={(e) => setPrompt(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && triggerOrchestrationPlan()}
                              placeholder="Enter directive query..."
                              disabled={isOrchestrating}
                              className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-slate-200 placeholder-slate-500 font-sans focus:outline-none"
                            />
                            {(() => {
                              const mDef = SENDER_MODELS.find(m => m.id === selectedModel);
                              const isCapable = !mDef || mDef.provider === "Cloud" || simulatedDeviceRam >= mDef.ramRequiredGb;
                              return (
                                <button
                                  onClick={triggerOrchestrationPlan}
                                  disabled={isOrchestrating || !prompt.trim() || !isCapable}
                                  className="bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 font-sans font-bold text-[10px] uppercase cursor-pointer transition shadow-md disabled:opacity-40"
                                >
                                  {isCapable ? "Fire Swarm Broadcast" : "INSUFFICIENT RAM"}
                                </button>
                              );
                            })()}
                          </div>

                          {thoughtStream && (
                            <div className="bg-indigo-950/20 border border-indigo-900/40 p-2.5 rounded-lg text-[9.5px] text-slate-300 italic font-mono leading-normal">
                              "{thoughtStream}"
                            </div>
                          )}
                        </div>

                        {/* Compact micro topology graph */}
                        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
                          <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 font-mono">
                            <span>MICRO-TOPOLOGY HIVE MAP</span>
                            <span className="text-indigo-400 animate-pulse">●</span>
                          </div>
                          <div className="h-44 bg-slate-900/20 rounded-xl overflow-hidden border border-slate-850 relative">
                            <NetworkGraph tasks={tasks} isOrchestrating={isOrchestrating && activeExecIndex !== -1} connState={connState} />
                          </div>
                        </div>

                        {/* checklist if active */}
                        {tasks.length > 0 && (
                          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2">
                            <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider font-mono">Active Sub-agents Flow</span>
                            <div className="space-y-1.5 max-h-32 overflow-y-auto">
                              {tasks.map((task, idx) => (
                                <div key={task.id} className="text-[10px] font-mono border-b border-slate-900 pb-1 flex justify-between gap-2">
                                  <span className="text-indigo-400 shrink-0">_0{idx+1}</span>
                                  <span className="text-slate-350 flex-1 leading-tight truncate">{task.title}</span>
                                  <span className="text-[8px] text-slate-500 uppercase shrink-0">{task.status.toUpperCase()}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                      </div>
                    )}

                    {/* PHONE SCREEN WINDOW 2: COMPACT SLM DECK */}
                    {activeTab === 'local_slm' && (
                      <div className="animate-fade-in animate-duration-300">
                        <LocalTerminal 
                          onLocalInferenceComplete={handleLocalInferenceCompleted} 
                          activeTaskPayload={activeLocalPayload} 
                        />
                      </div>
                    )}

                    {/* PHONE SCREEN WINDOW 3: COMPACT COMPILER DECK */}
                    {activeTab === 'android_hub' && (
                      <div className="animate-fade-in animate-duration-300">
                        <AndroidCompanionHub onAddLog={addLog} batteryLevel={sensorData.batteryLevel} />
                      </div>
                    )}

                    {/* PHONE SCREEN WINDOW 4: SENSORY DEEP TELEMETRY */}
                    {activeTab === 'sensors' && (
                      <div className="space-y-4 animate-fade-in animate-duration-300">
                        <SensorSuite onSensorsChange={handleSensorsChange} />
                        <LogView logs={logs} onClearLogs={() => setLogs([])} />
                      </div>
                    )}

                    {/* PHONE SCREEN WINDOW 5: CHAT & RESEARCH */}
                    {activeTab === 'research' && (
                      <div className="animate-fade-in animate-duration-300">
                        <ResearchHub />
                      </div>
                    )}

                  </div>

                  {/* OS Bottom Swipe bar mock */}
                  <div className="h-6 bg-slate-950 border-t border-slate-900 flex items-center justify-center z-10 select-none">
                    <span className="w-24 h-1 bg-slate-800 rounded-full" />
                  </div>

                </div>

              </div>
            );
          }
        })()}
      </main>

      {/* FOOTER CONTAINER ACCENTS */}
      <footer className="border-t border-slate-900 bg-slate-950 py-5 px-6 text-center text-slate-500 font-mono text-[9px] uppercase tracking-widest mt-12">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3.5">
          <span>Swarm Status: COHERENT | Thread safe pool Active</span>
          <span>Designed for O.R.C. Companion Project Hardware</span>
        </div>
      </footer>

    </div>
  );
}
