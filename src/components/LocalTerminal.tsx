import React, { useState, useEffect, useRef } from "react";
import { LocalModel } from "../types";
import { Cpu, Zap, Thermometer, Database, Play, Square, Sparkles } from "lucide-react";

interface LocalTerminalProps {
  onLocalInferenceComplete?: (output: string, stats: { executionTimeMs: number; tokens: number; tps: number }) => void;
  activeTaskPayload?: string;
}

const RUNTIME_MODELS: LocalModel[] = [
  {
    id: "gemma-2b-it-int4",
    name: "Gemma-2B-Instruct (INT4)",
    size: "1.42 GB",
    speedTps: 45,
    memoryUsageGb: 1.8,
    temperatureSpikeC: 4.8,
    description: "Google's ultra-lightweight architecture optimized for phone cores and fast sensory feedback."
  },
  {
    id: "phi-3-mini-4k-instruct",
    name: "Phi-3-Mini (INT4)",
    size: "2.20 GB",
    speedTps: 32,
    memoryUsageGb: 2.6,
    temperatureSpikeC: 7.2,
    description: "Highly polished 3.8B parameter model by Microsoft. Superb reasoning, high silicon stress."
  },
  {
    id: "llama-3-8b-q4_k_m",
    name: "Llama-3-8B (Q4_K_M)",
    size: "4.85 GB",
    speedTps: 18,
    memoryUsageGb: 5.2,
    temperatureSpikeC: 12.5,
    description: "Heavy-duty edge model. Extreme token fidelity, throttles standard device CPU thermal limit quickly."
  }
];

export default function LocalTerminal({ onLocalInferenceComplete, activeTaskPayload }: LocalTerminalProps) {
  const [selectedModel, setSelectedModel] = useState<LocalModel>(RUNTIME_MODELS[0]);
  const [prompt, setPrompt] = useState("");
  const [isInferring, setIsInferring] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  
  // Real-time simulated statistics
  const [currentTps, setCurrentTps] = useState(0);
  const [ramUsage, setRamUsage] = useState(0.4); // Initial baseline memory (e.g. OS memory)
  const [socTemp, setSocTemp] = useState(36.5); // Normal device idle body temp (Celsius)
  const [batteryDischarge, setBatteryDischarge] = useState(120); // Normal discharge in mA
  const [totalTokensGenerated, setTotalTokensGenerated] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textEndRef = useRef<HTMLDivElement>(null);

  // Auto Scroll the terminal output
  useEffect(() => {
    if (textEndRef.current) {
      textEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [streamedText]);

  // Handle outside activation (e.g., Hivemind agent task triggers local engine)
  useEffect(() => {
    if (activeTaskPayload) {
      triggerInference(activeTaskPayload);
    }
  }, [activeTaskPayload]);

  // Animate RAM blocks on canvas!
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animFrame: number;
    const blocksCount = 40;
    const blockWidth = canvas.width / 10 - 2;
    const blockHeight = canvas.height / 4 - 2;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Calculate what percentage of blocks should be lit
      const baseRam = 1.2; // OS memory
      const activeRam = isInferring ? selectedModel.memoryUsageGb : 0;
      const totalRam = 8.0; // Assume 8GB device
      const percentage = (baseRam + activeRam) / totalRam;
      const litCount = Math.floor(percentage * blocksCount);

      for (let i = 0; i < blocksCount; i++) {
        const x = (i % 10) * (blockWidth + 2) + 2;
        const y = Math.floor(i / 10) * (blockHeight + 2) + 2;

        if (i < litCount) {
          // Lit block color is based on consumption
          if (percentage > 0.7) {
            ctx.fillStyle = "#ef4444"; // Red for high RAM
          } else if (isInferring) {
            ctx.fillStyle = "#6366f1"; // Indigo for on-device run
          } else {
            ctx.fillStyle = "#1e293b"; // Dark slate for idle baseline
          }
        } else {
          ctx.fillStyle = "#090d16"; // Unallocated blocks
        }

        // Draw rounded rectangle
        ctx.beginPath();
        ctx.roundRect(x, y, blockWidth - 1, blockHeight - 1, 1.5);
        ctx.fill();
      }

      animFrame = requestAnimationFrame(render);
    };

    render();
    return () => cancelAnimationFrame(animFrame);
  }, [isInferring, selectedModel]);

  const triggerInference = (inputPrompt: string) => {
    if (isInferring || !inputPrompt.trim()) return;

    setIsInferring(true);
    setStreamedText("");
    setTotalTokensGenerated(0);

    // Dynamic responses generated depending on keywords
    const lowerPrompt = inputPrompt.toLowerCase();
    let samplePieces: string[] = [];

    if (lowerPrompt.includes("mic") || lowerPrompt.includes("sound") || lowerPrompt.includes("audio")) {
      samplePieces = [
        "Analyzing", " localized", " PCM", " acoustic", " footprint...", "\nIsolating", " spike", " thresholds", " to", " filter", " ambient", " background", " static.", "\n",
        "\n[SENSOR_REPORT]", " Ambient", " volume", " peaks", " registered", " at", " target", " ranges.", " Voice", " frequency", " structures", " validated.",
        "\nLocal", " check", " complete.", " Forwarding", " metadata", " tokens", " to", " remote", " cloud", " coordinator."
      ];
    } else if (lowerPrompt.includes("location") || lowerPrompt.includes("coordinate") || lowerPrompt.includes("lat")) {
      samplePieces = [
        "Resolving", " geo-coordinates", " on", " physical", " device", " GNSS", " array...", "\nEstablishing", " localized", " geofence", " integrity.", "\n",
        "\nLocation", " matrix", " matching", " standard", " safe-zone", " profiles.", " Compass", " vectoring", " reports", " no", " spatial", " displacement.",
        "\nState", " synchronized", " with", " swarm", " hivemind."
      ];
    } else if (lowerPrompt.includes("battery") || lowerPrompt.includes("telemetry") || lowerPrompt.includes("sensor")) {
      samplePieces = [
        "Querying", " on-board", " power", " registers", " and", " sub-core", " parameters...", "\nBattery", " thermals", " stable.", " Compute", " allowance", " at", " optimal", " budget.", "\n",
        "\nDiagnostics:", " SoC", " load:", " 22% |", " Thread", " count:", " 16", " active.", " Allocating", " remaining", " task", " slice", " to", " Local", " Edge", " SLM."
      ];
    } else {
      samplePieces = [
        "Initializing", " local", " prompt", " compilation", " with", " model", " weights...", "\nExecuting", " localized", " token", " parsing", " pipeline.", "\n",
        "\n[ON_DEVICE_OUTPUT]", " Directive", " matched", " successfully.", " Low-latency", " inference", " verified.", " Local", " sub-agent", " stands", " ready", " for", " next", " orchestrator", " handshake."
      ];
    }

    let wordIdx = 0;
    const stepMs = Math.max(10, Math.round(1000 / selectedModel.speedTps));

    // Stats simulation sweep during inference
    const statsTimer = setInterval(() => {
      setCurrentTps(Math.round(selectedModel.speedTps + (Math.random() * 4 - 2)));
      setRamUsage(prev => Math.min(selectedModel.memoryUsageGb + 0.1, prev + 0.3));
      setSocTemp(prev => Math.min(52.5, prev + (selectedModel.temperatureSpikeC / 7)));
      setBatteryDischarge(prev => Math.min(1850, prev + 120));
    }, 150);

    const streamTimer = setInterval(() => {
      if (wordIdx < samplePieces.length) {
        const val = samplePieces[wordIdx];
        setStreamedText(prev => prev + val);
        setTotalTokensGenerated(prev => prev + Math.ceil(val.length / 3));
        wordIdx++;
      } else {
        clearInterval(streamTimer);
        clearInterval(statsTimer);
        setIsInferring(false);
        setCurrentTps(0);
        
        // Return temp and discharge back toward resting state
        const coolDownTimer = setInterval(() => {
          setSocTemp(prev => Math.max(37.5, prev - 1.2));
          setBatteryDischarge(prev => Math.max(140, prev - 240));
          setRamUsage(prev => Math.max(0.4, prev - 0.5));
          if (socTemp <= 38 && batteryDischarge <= 200) {
            clearInterval(coolDownTimer);
          }
        }, 300);

        // Notify parent
        if (onLocalInferenceComplete) {
          onLocalInferenceComplete(samplePieces.join(""), {
            executionTimeMs: samplePieces.length * stepMs,
            tokens: Math.round(samplePieces.join("").length / 4),
            tps: selectedModel.speedTps
          });
        }
      }
    }, stepMs + 10);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl h-full justify-between">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-2.5">
          <Database className="w-5 h-5 text-indigo-400" />
          <h2 className="font-sans font-bold text-sm tracking-wide text-slate-100">Local SLM Engine</h2>
        </div>
        <div className="flex items-center gap-1.5 bg-indigo-950/40 border border-indigo-900 px-2.5 py-1 rounded-md text-[10px] font-mono text-indigo-400 font-semibold uppercase">
          <Sparkles className="w-3.5 h-3.5" />
          <span>On-Device Safe</span>
        </div>
      </div>

      {/* Model Selection Selector */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {RUNTIME_MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => !isInferring && setSelectedModel(m)}
            disabled={isInferring}
            className={`flex flex-col gap-1.5 p-3 rounded-xl border text-left cursor-pointer transition ${
              selectedModel.id === m.id
                ? "bg-indigo-950/20 border-indigo-800 text-indigo-300"
                : "bg-slate-950 border-slate-855 hover:border-slate-700 text-slate-400"
            } disabled:opacity-50`}
          >
            <div className="flex items-center justify-between w-full">
              <span className="font-sans text-[11px] font-bold tracking-wide">{m.name}</span>
              <span className="font-mono text-[9px] bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800/60 font-semibold">{m.size}</span>
            </div>
            <span className="font-mono text-[9px] text-slate-500 line-clamp-2">{m.description}</span>
          </button>
        ))}
      </div>

      {/* Physical Hardware Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 bg-slate-950 p-3.5 rounded-xl border border-slate-850">
        
        {/* Token Speedometer */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-indigo-950/40 border border-indigo-900 flex items-center justify-center">
            <Cpu className="w-4.5 h-4.5 text-indigo-400" />
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-xs font-bold text-slate-200">
              {isInferring ? `${currentTps} t/s` : "Idle"}
            </span>
            <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 font-mono">Silicon Speed</span>
          </div>
        </div>

        {/* Temperature Sensor */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-950/20 border border-red-900/50 flex items-center justify-center">
            <Thermometer className={`w-4.5 h-4.5 ${socTemp > 45 ? 'text-red-400' : 'text-orange-400'}`} />
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-xs font-bold text-slate-200">
              {socTemp.toFixed(1)}°C
            </span>
            <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 font-mono">SoC Thermal</span>
          </div>
        </div>

        {/* Battery Amp Consumption */}
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-amber-950/20 border border-amber-900/40 flex items-center justify-center">
            <Zap className={`w-4.5 h-4.5 ${isInferring ? 'text-amber-400' : 'text-slate-405'}`} />
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-xs font-bold text-slate-200">
              {batteryDischarge} mA
            </span>
            <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-500 font-mono">Power Drain</span>
          </div>
        </div>

        {/* On-Chip VRAM Map */}
        <div className="flex flex-col gap-1 w-full">
          <div className="flex items-center justify-between font-mono text-[9px] font-semibold text-slate-500 uppercase tracking-wider mb-0.5">
            <span>Unified VRAM Map</span>
            <span className="text-indigo-400 font-bold">{(isInferring ? (1.2 + selectedModel.memoryUsageGb) : 1.2).toFixed(1)}/8.0 GB</span>
          </div>
          <canvas ref={canvasRef} width="160" height="20" className="w-full h-4.5 bg-slate-950 border border-slate-900 rounded" />
        </div>
      </div>

      {/* Terminal View Output */}
      <div className="bg-slate-950 border border-slate-900 rounded-xl p-4 font-mono text-xs flex flex-col h-40 overflow-y-auto shadow-inner relative group">
        <div className="absolute top-2 right-2 text-[9px] uppercase text-slate-650 font-bold tracking-wider select-none">On-device tty</div>
        
        {streamedText ? (
          <div className="text-indigo-300 leading-relaxed whitespace-pre-wrap">
            {streamedText}
            {isInferring && <span className="inline-block w-1.5 h-4 bg-indigo-450 animate-pulse ml-0.5" />}
          </div>
        ) : (
          <div className="text-slate-650 italic select-none">
            Await companion device local query initialization... Send a trial prompt below or execute a synchronized Hivemind agent pipeline.
          </div>
        )}
        <div ref={textEndRef} />
      </div>

      {/* Inference controls */}
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && triggerInference(prompt)}
          placeholder={`Enter an on-device directive for ${selectedModel.name}...`}
          disabled={isInferring}
          className="bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-800 hover:border-slate-700 flex-1 transition disabled:opacity-50"
        />
        {isInferring ? (
          <button
            onClick={() => setIsInferring(false)}
            className="bg-red-950/50 border border-red-800 text-red-300 hover:bg-red-900/40 p-2.5 rounded-xl cursor-pointer transition flex items-center gap-1.5 font-sans font-bold text-xs shrink-0"
          >
            <Square className="w-4 h-4 fill-red-400" />
            <span>Halt</span>
          </button>
        ) : (
          <button
            onClick={() => triggerInference(prompt)}
            disabled={!prompt.trim()}
            className="bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-950/30 p-2.5 rounded-xl font-sans font-bold text-xs cursor-pointer transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
          >
            <Play className="w-4 h-4" />
            <span>Eval</span>
          </button>
        )}
      </div>
    </div>
  );
}
