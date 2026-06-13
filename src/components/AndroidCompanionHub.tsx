import React, { useState, useEffect } from "react";
import { 
  Shield, 
  Cpu, 
  Zap, 
  Network, 
  Activity, 
  Settings, 
  AlertCircle, 
  CheckCircle2, 
  Radio, 
  Gauge, 
  Globe, 
  RefreshCw,
  SlidersHorizontal,
  Lock,
  Wifi,
  Thermometer,
  Minimize2,
  Database
} from "lucide-react";

interface AndroidCompanionHubProps {
  onAddLog: (message: string, source: "SYSTEM" | "HIVEMIND" | "LOCAL_MODEL" | "SENSORS", level: "info" | "warn" | "success" | "hivemind") => void;
  batteryLevel: number | null;
}

export default function AndroidCompanionHub({ onAddLog, batteryLevel }: AndroidCompanionHubProps) {
  // Remote Connection states
  const [endpointUrl, setEndpointUrl] = useState("https://orc-hivemind.hardcoreerik.net/v2/secure-gateway");
  const [serialization, setSerialization] = useState<'protobuf' | 'json'>('protobuf');
  const [cipherSuite, setCipherSuite] = useState<'aes-256' | 'chacha20' | 'tls1.3'>('tls1.3');
  const [retryLimit, setRetryLimit] = useState(5);
  const [backoffFactor, setBackoffFactor] = useState(2.0);
  const [keepAlivePing, setKeepAlivePing] = useState(30);
  
  // Connection Diagnostics States
  const [isTestingConn, setIsTestingConn] = useState(false);
  const [testLog, setTestLog] = useState<string[]>([]);
  const [diagResults, setDiagResults] = useState<{
    latency: number;
    jitter: number;
    packetLoss: number;
    bandwidth: number;
    status: 'optimal' | 'unstable' | 'offline' | 'untested';
  }>({
    latency: 0,
    jitter: 0,
    packetLoss: 0,
    bandwidth: 0,
    status: 'untested'
  });

  // Local ML Model Optimization States
  const [quantization, setQuantization] = useState<'fp16' | 'int8' | 'q4' | 'int3'>('q4');
  const [accBackend, setAccBackend] = useState<'nnapi' | 'vulkan' | 'pytorch' | 'executorch'>('nnapi');
  const [corePinning, setCorePinning] = useState<'all' | 'big' | 'little'>('big');
  const [maxSoCTemp, setMaxSoCTemp] = useState(45);
  const [batteryCutoff, setBatteryCutoff] = useState(20);

  // Benchmarking states
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchStep, setBenchStep] = useState("");
  const [lastBenchmark, setLastBenchmark] = useState<{
    tps: number;
    ramGb: number;
    watts: number;
    accuracyDegradation: number; // %
  } | null>(null);

  // Run initial diagnostic notification logs
  useEffect(() => {
    onAddLog("Android Companion Subsystem ready. Loaded custom model quantization configurations.", "SYSTEM", "info");
  }, []);

  // Secure Connection ping test simulator
  const runConnectionDiagnostics = () => {
    if (isTestingConn) return;
    setIsTestingConn(true);
    setTestLog([]);
    setDiagResults(prev => ({ ...prev, status: 'untested' }));
    
    onAddLog("Starting Secure Tunnel network probe to: " + endpointUrl, "SYSTEM", "info");

    const steps = [
      { text: "Initiating TLS 1.3 cryptographic handshake protocol...", delay: 400 },
      { text: `Negotiating encryption cipher suite: ${cipherSuite.toUpperCase()}`, delay: 800 },
      { text: `Serializing connection parameters via Google Protobuf format...`, delay: 1200 },
      { text: "Transmitting payload envelope to secure endpoint...", delay: 1800 },
      { text: "Server response received. Parsing response telemetry payload...", delay: 2400 },
      { text: "Remote Hivemind verified. Secure tunnel stabilized.", delay: 3000 }
    ];

    steps.forEach((step, idx) => {
      setTimeout(() => {
        setTestLog(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${step.text}`]);
        
        if (idx === steps.length - 1) {
          setIsTestingConn(false);
          const mockLatency = Math.floor(25 + Math.random() * 20);
          const mockJitter = Math.floor(1 + Math.random() * 4);
          setDiagResults({
            latency: mockLatency,
            jitter: mockJitter,
            packetLoss: 0.0,
            bandwidth: 12.8,
            status: 'optimal'
          });
          onAddLog(`Network link optimal: Latency=${mockLatency}ms, packetLoss=0% over secure tunnel.`, "HIVEMIND", "success");
        }
      }, step.delay);
    });
  };

  // On-Device ML Benchmark Simulator
  const runModelBenchmark = () => {
    if (isBenchmarking) return;
    setIsBenchmarking(true);
    setBenchStep("Initializing execution context on target device...");

    // Setup progressive simulator steps
    const steps = [
      { msg: "Loading model weights into target memory partition...", delay: 600 },
      { msg: `Setting up hardware accelerator backend context: [${accBackend.toUpperCase()}]`, delay: 1200 },
      { msg: `Applying core isolation pinning to ${corePinning} cores...`, delay: 1800 },
      { msg: "Executing 512-token sequence inference warp...", delay: 2500 },
      { msg: "Calculating thermal envelope and power leakage...", delay: 3200 },
      { msg: "Benchmark completed.", delay: 3800 }
    ];

    steps.forEach((step, idx) => {
      setTimeout(() => {
        setBenchStep(step.msg);
        
        if (idx === steps.length - 1) {
          setIsBenchmarking(false);
          setBenchStep("");

          // Calculate metrics based on selected quantization and backend accelerator
          let tps = 14.5;
          let ramGb = 4.1;
          let watts = 2.4;
          let accuracyDegradation = 2.1;

          // Quantization adjustments
          if (quantization === 'fp16') {
            tps = accBackend === 'nnapi' ? 8.2 : 6.1;
            ramGb = 16.2;
            watts = 4.8;
            accuracyDegradation = 0.0;
          } else if (quantization === 'int8') {
            tps = accBackend === 'nnapi' ? 18.4 : 14.2;
            ramGb = 8.1;
            watts = 3.2;
            accuracyDegradation = 0.4;
          } else if (quantization === 'q4') {
            tps = accBackend === 'nnapi' ? 24.8 : 19.5;
            ramGb = 4.1;
            watts = 2.1;
            accuracyDegradation = 1.8;
          } else if (quantization === 'int3') {
            tps = accBackend === 'nnapi' ? 32.1 : 26.4;
            ramGb = 3.2;
            watts = 1.6;
            accuracyDegradation = 14.5;
          }

          // Backend speed adjustments
          if (accBackend === 'vulkan') {
            tps *= 1.1;
            watts *= 1.2;
          } else if (accBackend === 'pytorch') {
            tps *= 0.7;
            watts *= 0.9;
          } else if (accBackend === 'executorch') {
            tps *= 1.25;
            watts *= 0.85;
          }

          // Thread/core adjustments
          if (corePinning === 'little') {
            tps *= 0.4;
            watts *= 0.3;
          } else if (corePinning === 'all') {
            tps *= 1.2;
            watts *= 1.5;
          }

          const roundedTps = Math.round(tps * 100) / 100;
          const roundedRam = Math.round(ramGb * 100) / 100;
          const roundedWatts = Math.round(watts * 100) / 100;
          const roundedAcc = Math.round(accuracyDegradation * 100) / 100;

          setLastBenchmark({
            tps: roundedTps,
            ramGb: roundedRam,
            watts: roundedWatts,
            accuracyDegradation: roundedAcc
          });

          onAddLog(`Benchmark Complete! Quantization: ${quantization.toUpperCase()} | Speed: ${roundedTps} T/S | RAM: ${roundedRam}GB | Power: ${roundedWatts}W`, "LOCAL_MODEL", "success");
        }
      }, step.delay);
    });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      
      {/* CARD 1: SECURE CONNECTION CONTROLLER */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-500/5 to-transparent blur-xl" />
        
        {/* Header Title */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Network Gateway</h2>
            <p className="text-sm font-mono text-slate-400 mt-1">Remote Secure Hivemind Router</p>
          </div>
          <Shield className="w-5 h-5 text-indigo-400" />
        </div>

        {/* Configurations Fields */}
        <div className="space-y-3.5 my-1">
          {/* Endpoint Url */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Gateway Secure IP/URL</label>
            <input 
              type="text" 
              value={endpointUrl} 
              onChange={(e) => setEndpointUrl(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-350 focus:outline-none focus:border-indigo-800 tracking-tight font-mono transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {/* Serialization Dropdown */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Serialization</label>
              <select 
                value={serialization} 
                onChange={(e) => {
                  const val = e.target.value as any;
                  setSerialization(val);
                  onAddLog(`Serialization scheme adjusted to: ${val === 'protobuf' ? 'Protobuf Compact Binary' : 'JSON Compressed UTF-8'}`, "SYSTEM", "info");
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-800 cursor-pointer"
              >
                <option value="protobuf">Protobuf (Binary)</option>
                <option value="json">JSON (UTF-8)</option>
              </select>
            </div>

            {/* Cipher suite selection */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Cipher Protocol</label>
              <select 
                value={cipherSuite} 
                onChange={(e) => {
                  const val = e.target.value as any;
                  setCipherSuite(val);
                  onAddLog(`Cryptographic secure suite optimized: ${val.toUpperCase()}`, "SYSTEM", "info");
                }}
                className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-indigo-800 cursor-pointer"
              >
                <option value="tls1.3">TLS 1.3 / ECDSA</option>
                <option value="aes-256">AES-256-GCM / RSA</option>
                <option value="chacha20">ChaCha20-Poly1305</option>
              </select>
            </div>
          </div>

          {/* Reliability rules */}
          <div className="border-t border-slate-850 pt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-400 font-mono">
            <div>
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Retry Limit</span>
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 px-2 py-1 rounded-lg">
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={retryLimit}
                  onChange={(e) => setRetryLimit(parseInt(e.target.value))}
                  className="w-full accent-indigo-500 h-1 bg-slate-800 cursor-pointer"
                />
                <span className="text-indigo-400 font-bold">{retryLimit}x</span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Backoff Factor</span>
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 px-2 py-1 rounded-lg">
                <input 
                  type="range" 
                  min="1" 
                  max="4" 
                  step="0.5"
                  value={backoffFactor}
                  onChange={(e) => setBackoffFactor(parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 h-1 bg-slate-800 cursor-pointer"
                />
                <span className="text-indigo-400 font-bold">{backoffFactor.toFixed(1)}s</span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 uppercase text-[9px] block mb-1">Keep Alive</span>
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 px-2 py-1 rounded-lg">
                <input 
                  type="range" 
                  min="10" 
                  max="120" 
                  step="10"
                  value={keepAlivePing}
                  onChange={(e) => setKeepAlivePing(parseInt(e.target.value))}
                  className="w-full accent-indigo-500 h-1 bg-slate-800 cursor-pointer"
                />
                <span className="text-indigo-400 font-bold">{keepAlivePing}s</span>
              </div>
            </div>
          </div>
        </div>

        {/* Interactive Diagnostics panel */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 flex flex-col gap-2 font-mono">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5 text-indigo-400" />
              DIAGNOSTICS STATS
            </span>
            <span className={`text-[9px] px-2 py-0.5 rounded font-bold ${
              diagResults.status === 'optimal' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-900/30' :
              diagResults.status === 'untested' ? 'bg-slate-900 text-slate-500/70 border border-slate-850' :
              'bg-indigo-950/20 text-indigo-400'
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

          {/* Scrolling test logs */}
          {testLog.length > 0 && (
            <div className="border-t border-slate-900 pt-2 text-[9px] text-slate-400 space-y-1 max-h-16 overflow-y-auto pr-1">
              {testLog.map((line, idx) => (
                <div key={idx} className="line-clamp-1 leading-normal italic text-slate-500">{line}</div>
              ))}
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
                <span>Running Secure Tunnel Test Handshake...</span>
              </>
            ) : (
              <>
                <Wifi className="w-3.5 h-3.5" />
                <span>Deep Diagnostics Secure Tunnel Pulse</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* CARD 2: LOCAL ML MODEL OPTIMIZATION AND BENCHMARKING */}
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between gap-4 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-violet-500/5 to-transparent blur-xl" />
        
        {/* Header Title */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Compiler Pipeline</h2>
            <p className="text-sm font-mono text-slate-400 mt-1">Local SLM Android Acceleration</p>
          </div>
          <Cpu className="w-5 h-5 text-violet-400" />
        </div>

        {/* Optimization Options */}
        <div className="grid grid-cols-2 gap-3.5 my-1">
          {/* Model Quantization Level */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Bit-Quantization</span>
            <div className="grid grid-cols-2 gap-1.5 select-none text-[9px] font-mono font-bold">
              {[
                { id: 'fp16', label: 'FP16' },
                { id: 'int8', label: 'INT8' },
                { id: 'q4', label: '4-Bit' },
                { id: 'int3', label: '3-Bit' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setQuantization(opt.id as any);
                    onAddLog(`Android quantization level optimized to: ${opt.label}. Compilation weights verified.`, "LOCAL_MODEL", "info");
                  }}
                  className={`py-1.5 px-1 bg-slate-950 border rounded-lg transition uppercase cursor-pointer text-center ${
                    quantization === opt.id 
                    ? 'border-violet-500 text-violet-300 shadow bg-violet-950/10' 
                    : 'border-slate-850 text-slate-500 hover:text-slate-350'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Inference Engines Acceleration */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-mono font-bold text-slate-500 uppercase tracking-wider">Acceleration API</label>
            <div className="grid grid-cols-1 gap-1.5 select-none text-[9px] font-mono font-bold">
              {[
                { id: 'nnapi', label: 'NNAPI (NPU Swarm Core)' },
                { id: 'vulkan', label: 'Vulkan GPU backend' },
                { id: 'pytorch', label: 'PyTorch Mobile Engine' },
                { id: 'executorch', label: 'ExecuTorch Compiler' }
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setAccBackend(opt.id as any);
                    onAddLog(`Android device hardware acceleration swapped: [${opt.label}]`, "SYSTEM", "info");
                  }}
                  className={`py-1.5 px-2 bg-slate-950 border rounded-lg transition text-left cursor-pointer flex justify-between items-center ${
                    accBackend === opt.id 
                    ? 'border-violet-500 text-violet-300 bg-violet-950/10' 
                    : 'border-slate-850 text-slate-500 hover:text-slate-350'
                  }`}
                >
                  <span>{opt.label.split(" (")[0]}</span>
                  <span className="text-[8px] text-slate-550 opacity-80">v2.4</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Sliders: Core pinning / Thermal mitigation */}
        <div className="border-t border-slate-850 pt-2 grid grid-cols-2 gap-3.5 text-[10px] font-mono">
          <div className="flex flex-col gap-1 text-slate-400">
            <span className="text-slate-500 text-[9px] uppercase font-bold">Core Affinity Pinning</span>
            <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 p-1 rounded-lg">
              {(['all', 'big', 'little'] as const).map(core => (
                <button
                  key={core}
                  onClick={() => {
                    setCorePinning(core);
                    onAddLog(`CPU Core Affinity pinned to: ${core === 'big' ? 'Performance Big Cores' : core === 'little' ? 'Efficient Little Cores' : 'All available cores'}`, "SYSTEM", "info");
                  }}
                  className={`flex-1 py-1 rounded-md text-[8px] uppercase font-bold text-center cursor-pointer transition ${
                    corePinning === core 
                    ? 'bg-violet-950/40 text-violet-300 border border-violet-900/30 font-extrabold'
                    : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  {core}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-between">
            <div>
              <span className="text-slate-500 uppercase text-[9px] block">Max Thermal limit</span>
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 px-2 py-1 rounded-lg mt-1 w-20">
                <input 
                  type="range" 
                  min="35" 
                  max="60" 
                  value={maxSoCTemp}
                  onChange={(e) => setMaxSoCTemp(parseInt(e.target.value))}
                  className="w-full accent-violet-500 h-1 bg-slate-800 cursor-pointer"
                />
                <span className="text-violet-400 font-bold text-[9px] whitespace-nowrap">{maxSoCTemp}°C</span>
              </div>
            </div>

            <div>
              <span className="text-slate-500 uppercase text-[9px] block">Battery Cutoff</span>
              <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800/60 px-2 py-1 rounded-lg mt-1 w-20">
                <input 
                  type="range" 
                  min="10" 
                  max="40" 
                  step="5"
                  value={batteryCutoff}
                  onChange={(e) => setBatteryCutoff(parseInt(e.target.value))}
                  className="w-full accent-violet-500 h-1 bg-slate-800 cursor-pointer"
                />
                <span className="text-violet-400 font-bold text-[9px] whitespace-nowrap">{batteryCutoff}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Benchmark Visual metrics block */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3 flex flex-col gap-2 font-mono justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
              <Gauge className="w-3.5 h-3.5 text-violet-400" />
              ACCELERATION BENCHMARKS
            </span>
            <span className="text-[9px] text-slate-600 font-bold uppercase">Real-Time Profiler</span>
          </div>

          {/* Benchmark execution state indicator */}
          {benchStep ? (
            <div className="h-12 flex flex-col items-center justify-center text-center gap-1">
              <span className="text-[9px] text-violet-400 animate-pulse font-semibold uppercase">{benchStep}</span>
              <div className="h-1 w-40 bg-slate-900 rounded-full overflow-hidden">
                <div className="h-full bg-violet-500 animate-[pulse_1.5s_infinite] w-full" />
              </div>
            </div>
          ) : lastBenchmark ? (
            <div className="grid grid-cols-4 gap-2 text-center border-t border-slate-900 pt-2 text-[10px]">
              <div>
                <span className="text-slate-550 text-[8px] block">EVAL RATE</span>
                <span className="text-emerald-400 font-bold">{lastBenchmark.tps} T/S</span>
              </div>
              <div>
                <span className="text-slate-550 text-[8px] block">RAM FOOTPRINT</span>
                <span className="text-slate-300 font-bold">{lastBenchmark.ramGb} GB</span>
              </div>
              <div>
                <span className="text-slate-550 text-[8px] block">POWER IMPACT</span>
                <span className="text-amber-400 font-bold">{lastBenchmark.watts} Watts</span>
              </div>
              <div>
                <span className="text-slate-555 text-[8px] block">PERPLEXITY DEGR.</span>
                <span className={`font-bold ${lastBenchmark.accuracyDegradation > 5.0 ? 'text-red-400' : 'text-slate-400'}`}>
                  +{lastBenchmark.accuracyDegradation}%
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[9px] text-slate-650 italic text-center py-2">
              Optimize quantization values & accelerators above, then initiate benchmark profile scan below.
            </div>
          )}

          <button
            onClick={runModelBenchmark}
            disabled={isBenchmarking}
            className="w-full bg-violet-600 hover:bg-violet-500 text-white rounded-lg py-1.5 font-sans font-bold text-[10px] uppercase cursor-pointer transition flex items-center justify-center gap-1.5 disabled:opacity-40"
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Profile Model Acceleration Index</span>
          </button>
        </div>

      </div>

    </div>
  );
}
