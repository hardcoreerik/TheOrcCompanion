import React, { useState, useRef, useEffect } from "react";
import { 
  Search, Send, Play, FileText, ExternalLink, Image as ImageIcon, 
  Cpu, BookOpen, Terminal, X, ChevronRight, Sparkles, Download, 
  Loader2, HelpCircle, Info, Disc, Video, Database, MessageSquare
} from "lucide-react";

interface MediaAttachment {
  type: "video" | "image" | "document" | "link";
  title: string;
  url: string;
  thumbnailUrl?: string;
  description: string;
}

interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  timestamp: string;
  text: string;
  media?: MediaAttachment[];
}

export default function ResearchHub() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      sender: "assistant",
      timestamp: new Date().toISOString(),
      text: "O.R.C. Research & Intelligence terminal online. Broadcast tactical parameters. You can run deep queries or explore mock swarm documents and field testing videos below directly in-app.",
      media: [
        {
          type: "document",
          title: "Hardcoreerik/TheOrc Swarm Spec v2.10",
          url: "DOC_TEXT_SWARM_SPEC_SHEET",
          description: "Technical document outlining command architectures and the multi-agent orchestration paradigm."
        },
        {
          type: "video",
          title: "Autonomous Drone Swarm Flight Patterns",
          url: "https://www.youtube.com/embed/m6g2pP2NidI",
          description: "Tactical air coordination field testing under regional sub-node synchronizations."
        }
      ]
    }
  ]);
  
  const [inputQuery, setInputQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentActiveMedia, setCurrentActiveMedia] = useState<MediaAttachment | null>(null);
  const [activeDocTab, setActiveDocTab] = useState<"preview" | "source">("preview");
  
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const triggerQuery = async (queryText: string) => {
    if (!queryText.trim() || loading) return;
    
    // Append user message
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-user`,
      sender: "user",
      timestamp: new Date().toISOString(),
      text: queryText
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInputQuery("");
    setLoading(true);

    try {
      const response = await fetch("/api/hivemind/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: queryText })
      });

      if (!response.ok) {
        throw new Error(`Intelligence transmission failed: status ${response.status}`);
      }

      const result = await response.json();
      
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        sender: "assistant",
        timestamp: new Date().toISOString(),
        text: result.text || "Direct answer processed from secure central cluster database.",
        media: result.media || []
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      const errorMsg: ChatMessage = {
        id: `msg-${Date.now()}-assistant`,
        sender: "assistant",
        timestamp: new Date().toISOString(),
        text: `COMM PROTOCOL ERROR: Central repository offline or connection key missing. Local cached safe-telemetry returned.\nRaw logs: ${err.message}`,
        media: [
          {
            type: "link",
            title: "Check System Logs",
            url: "https://github.com/Hardcoreerik/TheOrc",
            description: "Review core connection buffers and SSH keys."
          }
        ]
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handlePresetClick = (preset: string) => {
    triggerQuery(preset);
  };

  const closeMediaViewer = () => {
    setCurrentActiveMedia(null);
  };

  const selectMedia = (media: MediaAttachment) => {
    setCurrentActiveMedia(media);
    setActiveDocTab("preview");
  };

  // Pre-seeded topics fitting Hardcoreerik/TheOrc branding perfectly
  const presets = [
    { label: "Swarm Autonomy", query: "Show me autonomous drone swarm logs in-app videos" },
    { label: "Vulkan Compiling Spec", query: "Load Vulkan SLM compiling benchmark specs" },
    { label: "TheOrc Spec Document", query: "Load raw spec sheet document" }
  ];

  // Raw interactive documents
  const mockDocuments: Record<string, { body: string; code: string }> = {
    DOC_TEXT_SWARM_SPEC_SHEET: {
      body: `THE O.R.C. SWARM ORCHESTRATOR SPECIFICATION SHEET v2.10
===================================================
Tactical Multi-Agent Command Core Diagnostics

1. OVERVIEW
The central objective of TheOrc (Orchestrated Swarm Core) is to coordinate on-device Android sensory feeds with server-side heavy models. It splits operations, ensuring local CPUs handle latency-critical alerts while cloud nodes coordinate master directives.

2. SECURED COMM CHANNELS
- default_port: 3000
- proxy_layer: Nginx Ingress routing
- handshake: SHA-256 baseline
- offline_fallback: Simulated offline SLM stack (Gemma 2B / Phi-3)

3. COHERENCE SYNC FLOW
Upon user directive entry, the internal compiler creates a custom DAG mapping local sensory captures and telemetry data. This minimizes server-side compute times.`,
      code: `{
  "orchestrator": "TheOrc Swarm V2.10",
  "build_config": {
    "engine": "vulkan_accelerated",
    "telemetry_sync": "active",
    "failover": "isolated_local"
  },
  "supported_profiles": ["edge-slm", "cloud-expert"]
}`
    },
    JSON_DATA_ORC_COMPILER_MATRIX: {
      body: `O.R.C. VULKAN COMPlLING MATRIX & BENCHMARKS
=============================================
Edge-first offloading analytics on high-precision devices

- Platform: Vulkan GPU Compute v1.3 / Android NNAPI
- Memory Limit: 4.0 GB simulated ceiling
- Coherence Weight: Q4_K_M GGUF format
- Tested Core Speeds:
  * Gemma 2B Edge: 28.5 tokens/sec
  * Phi-3 Mini: 18.2 tokens/sec
  * LLaMA 8B FP16: 4.8 tokens/sec (High Memory Strain)`,
      code: `{
  "platforms": {
    "vulkan_nnapi": {
      "status": "fully_capable",
      "required_ram_gb": 4,
      "tflops": 4.5
    },
    "cpu_only": {
      "status": "degraded_fallback",
      "required_ram_gb": 2,
      "tflops": 0.82
    }
  }
}`
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-[630px] lg:h-[680px]">
      
      {/* LEFT COLUMN: INTEL VIEWPORT & CHAT TERMINAL */}
      <div className="lg:col-span-7 flex flex-col bg-[#030712]/60 border border-slate-900 rounded-2xl overflow-hidden shadow-xl">
        
        {/* Terminal Header */}
        <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-indigo-400 animate-pulse" />
            <span className="font-mono text-[10.5px] font-extrabold text-slate-200 tracking-wider uppercase">
              O.R.C. RESEARCH STATION
            </span>
          </div>
          <div className="flex items-center gap-1.5 bg-[#02050c] px-2 py-0.5 rounded border border-slate-850">
            <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
            <span className="font-mono text-[9px] text-slate-500 font-bold uppercase tracking-wider">
              SWARM CORE
            </span>
          </div>
        </div>

        {/* Message Feeds Scroll Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs no-scrollbar">
          
          {messages.map(msg => (
            <div 
              key={msg.id} 
              className={`flex flex-col gap-1.5 max-w-[88%] ${msg.sender === "user" ? "ml-auto items-end" : "mr-auto items-start"}`}
            >
              {/* Message Meta Info */}
              <div className="flex items-center gap-1.5 text-[9px] text-slate-500 uppercase tracking-wider">
                <span>{msg.sender === "user" ? "Local Node" : "Hivemind Core"}</span>
                <span>&bull;</span>
                <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>

              {/* Chat Bubble Card */}
              <div className={`p-4 rounded-xl border border-slate-850 shadow-md ${
                msg.sender === "user" 
                  ? "bg-indigo-950/40 border-indigo-900/50 text-indigo-200" 
                  : "bg-slate-950/70 border-slate-900 text-slate-300"
              }`}>
                <p className="whitespace-pre-wrap leading-relaxed select-text font-sans">{msg.text}</p>
                
                {/* Embedded Media Attachment Chips inside Chat Bubble */}
                {msg.media && msg.media.length > 0 && (
                  <div className="mt-3.5 pt-3.5 border-t border-slate-900/80 flex flex-col gap-2.5">
                    <span className="text-[9px] font-extrabold text-indigo-400 tracking-wider block uppercase">
                      INCOMING MEDIA DETECTED:
                    </span>
                    <div className="flex flex-col xl:flex-row gap-2">
                      {msg.media.map((item, idx) => (
                        <button
                          key={idx}
                          onClick={() => selectMedia(item)}
                          className="flex items-center gap-2 px-2.5 py-2 bg-slate-900/80 hover:bg-slate-850 border border-slate-800 rounded-lg text-left transition text-[10px] w-full xl:w-auto cursor-pointer"
                        >
                          {item.type === "video" && <Video className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                          {item.type === "image" && <ImageIcon className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                          {item.type === "document" && <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                          {item.type === "link" && <ExternalLink className="w-3.5 h-3.5 text-violet-400 shrink-0" />}
                          
                          <div className="truncate">
                            <span className="font-bold text-slate-300 block truncate">{item.title}</span>
                            <span className="text-slate-500 block text-[8px] truncate">{item.description}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 py-1 font-mono">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
              <span className="text-[10px] tracking-wider uppercase animate-pulse">
                Establishing Satellite Uplink... compiling intel
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Preset suggestions & inputs */}
        <div className="p-4 bg-slate-950/80 border-t border-slate-900 flex flex-col gap-3">
          
          {/* Presets Row */}
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth">
            <span className="text-[9px] font-extrabold text-slate-500 whitespace-nowrap uppercase tracking-widest mr-1">
              DEMO TOPICS:
            </span>
            {presets.map((preset, idx) => (
              <button
                key={idx}
                disabled={loading}
                onClick={() => handlePresetClick(preset.query)}
                className="px-2.5 py-1 bg-slate-900/50 hover:bg-slate-850 disabled:opacity-40 text-slate-400 hover:text-indigo-300 rounded border border-slate-800 text-[10px] font-bold font-mono transition cursor-pointer whitespace-nowrap uppercase tracking-wide"
              >
                {preset.label}
              </button>
            ))}
          </div>

          {/* Form */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={inputQuery}
                disabled={loading}
                onChange={e => setInputQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") triggerQuery(inputQuery);
                }}
                placeholder="Query central research index... e.g. Autonomy"
                className="w-full bg-slate-900 border border-slate-805 rounded-xl px-4 py-2.5 pl-9 text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-indigo-800 hover:border-slate-800 transition disabled:opacity-50"
              />
              <Search className="absolute left-3 top-3 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
            
            <button
              onClick={() => triggerQuery(inputQuery)}
              disabled={loading || !inputQuery.trim()}
              className="bg-indigo-600 hover:bg-indigo-510 hover:bg-indigo-500 text-white p-2.5 rounded-xl transition cursor-pointer disabled:opacity-40 flex items-center justify-center shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>

          <div className="text-[8.5px] text-slate-600 leading-normal text-center font-mono uppercase tracking-widest">
            Hardcoreerik / O.R.C. Hivemind Encryption Core Enabled
          </div>

        </div>
      </div>

      {/* RIGHT COLUMN: INTERACTIVE APPLET MEDIA PLAYBACK & VIEWER */}
      <div className="lg:col-span-5 flex flex-col bg-[#030712]/60 border border-slate-900 rounded-2xl overflow-hidden shadow-xl min-h-[300px]">
        
        {/* Media Header */}
        <div className="bg-slate-950/80 px-4 py-3 border-b border-slate-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-violet-400" />
            <span className="font-mono text-[10.5px] font-extrabold text-slate-200 tracking-wider uppercase">
              TACTICAL INTERACTIVE DECK
            </span>
          </div>
          {currentActiveMedia && (
            <button
              onClick={closeMediaViewer}
              className="p-1 hover:bg-slate-900 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Dynamic Frame Display */}
        <div className="flex-1 p-4 flex flex-col justify-center items-center relative overflow-y-auto">
          
          {currentActiveMedia ? (
            <div className="w-full h-full flex flex-col gap-4">
              
              {/* Media Title Area */}
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-900 flex items-start justify-between gap-2">
                <div>
                  <span className="text-[8px] font-black text-violet-400 font-mono tracking-widest uppercase block mb-1">
                    {currentActiveMedia.type.toUpperCase()} PREVIEW ACTIVE
                  </span>
                  <h3 className="text-xs font-bold font-mono text-slate-200 leading-tight">
                    {currentActiveMedia.title}
                  </h3>
                  <p className="text-[10px] text-slate-450 mt-1 font-sans leading-relaxed">
                    {currentActiveMedia.description}
                  </p>
                </div>
                
                {/* Media type icon banner */}
                <div className="bg-indigo-950/40 p-2 rounded-lg border border-indigo-900/30 shrink-0">
                  {currentActiveMedia.type === "video" && <Video className="w-4 h-4 text-rose-450 text-rose-400" />}
                  {currentActiveMedia.type === "image" && <ImageIcon className="w-4 h-4 text-emerald-450 text-emerald-400" />}
                  {currentActiveMedia.type === "document" && <FileText className="w-4 h-4 text-cyan-450 text-cyan-400" />}
                  {currentActiveMedia.type === "link" && <ExternalLink className="w-4 h-4 text-violet-440 text-violet-400" />}
                </div>
              </div>

              {/* Dynamic Interactive Object Renderers based on Attachment Type */}
              <div className="flex-1 flex flex-col min-h-0">
                
                {/* 1. VIDEO RENDERER */}
                {currentActiveMedia.type === "video" && (
                  <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-slate-850 bg-black shadow-inner flex items-center justify-center">
                    {currentActiveMedia.url.includes("youtube.com") || currentActiveMedia.url.includes("youtu.be") ? (
                      <iframe
                        src={currentActiveMedia.url}
                        title={currentActiveMedia.title}
                        className="w-full h-full absolute inset-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    ) : (
                      // HTML5 Fallback
                      <video 
                        src={currentActiveMedia.url} 
                        controls 
                        className="w-full h-full"
                      />
                    )}
                  </div>
                )}

                {/* 2. IMAGE RENDERER */}
                {currentActiveMedia.type === "image" && (
                  <div className="relative flex-1 bg-black rounded-xl overflow-hidden border border-slate-850 flex items-center justify-center p-2">
                    <img 
                      src={currentActiveMedia.url} 
                      alt={currentActiveMedia.title}
                      referrerPolicy="no-referrer"
                      className="max-h-full max-w-full rounded-lg object-contain border border-slate-900"
                    />
                  </div>
                )}

                {/* 3. DOCUMENT RENDERER (TheOrc formatted spec reader) */}
                {currentActiveMedia.type === "document" && (
                  <div className="flex-1 bg-[#02050c] rounded-xl border border-slate-900 overflow-hidden flex flex-col font-mono text-xs">
                    {/* Doc Sub tabs */}
                    <div className="flex bg-[#030712] border-b border-slate-900 text-[10px]">
                      <button
                        onClick={() => setActiveDocTab("preview")}
                        className={`flex-1 py-2 text-center uppercase tracking-wider font-bold transition cursor-pointer ${
                          activeDocTab === "preview"
                            ? "bg-indigo-950/30 text-indigo-300 border-b-2 border-indigo-500"
                            : "text-slate-500 hover:text-slate-350"
                        }`}
                      >
                        Preview Document
                      </button>
                      <button
                        onClick={() => setActiveDocTab("source")}
                        className={`flex-1 py-2 text-center uppercase tracking-wider font-bold transition cursor-pointer ${
                          activeDocTab === "source"
                            ? "bg-indigo-950/30 text-indigo-300 border-b-2 border-indigo-500"
                            : "text-slate-500 hover:text-slate-350"
                        }`}
                      >
                        Raw JSON specs
                      </button>
                    </div>

                    {/* Viewer Content */}
                    <div className="flex-1 p-3 overflow-y-auto text-[10.5px]">
                      {(() => {
                        const docObj = mockDocuments[currentActiveMedia.url] || {
                          body: `SWARM MANUAL TRANSMISSION\n=========================\n\nURL Parameters: ${currentActiveMedia.url}\n\nThis document is hosted directly on secure decentral registers. Close deck or query details.`,
                          code: JSON.stringify({ documentUrl: currentActiveMedia.url }, null, 2)
                        };

                        if (activeDocTab === "preview") {
                          return (
                            <div className="text-slate-300 font-sans whitespace-pre-wrap leading-relaxed select-text p-2">
                              {docObj.body}
                            </div>
                          );
                        } else {
                          return (
                            <pre className="text-emerald-400 font-mono text-[9.5px] p-2 bg-[#010307]/80 rounded border border-slate-850/40 select-all overflow-x-auto leading-normal">
                              {docObj.code}
                            </pre>
                          );
                        }
                      })()}
                    </div>
                  </div>
                )}

                {/* 4. LINK RENDERER (Clean redirect helper) */}
                {currentActiveMedia.type === "link" && (
                  <div className="flex-1 flex flex-col justify-center items-center text-center gap-4 bg-slate-950/40 boder border-slate-900 border border-slate-900 rounded-xl p-5">
                    <div className="w-12 h-12 rounded-full bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-center text-indigo-400 animate-pulse">
                      <ExternalLink className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold font-mono text-slate-200 uppercase tracking-wide">
                        Secure Redirect Protocol
                      </h4>
                      <p className="text-[10px] text-slate-500 font-mono mt-1 w-64 leading-normal">
                        Verify local encryption flags before egressing to public internet loops:
                      </p>
                      <pre className="text-[9px] text-slate-600 font-mono bg-[#02050c] px-3 py-1.5 rounded mt-2 select-all max-w-[260px] truncate">
                        {currentActiveMedia.url}
                      </pre>
                    </div>
                    <a
                      href={currentActiveMedia.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-bold font-mono tracking-wider items-center gap-1.5 shadow-md flex cursor-pointer transition uppercase"
                    >
                      <span>EGRESS TO LINK</span>
                      <ChevronRight className="w-3 h-3" />
                    </a>
                  </div>
                )}

              </div>
              
            </div>
          ) : (
            // Empty State
            <div className="flex flex-col justify-center items-center text-center gap-3 select-none text-slate-600 px-6 font-mono">
              <Compass className="w-10 h-10 text-slate-700 stroke-[1.5] animate-spin" style={{ animationDuration: "12s" }} />
              <div>
                <span className="text-[10px] font-extrabold text-slate-500 block uppercase tracking-wider">
                  DECK IDLE
                </span>
                <p className="text-[9.5px] text-slate-605 text-slate-500 max-w-[210px] uppercase tracking-wide leading-relaxed mt-1">
                  Query a topic or click on any incoming chat attachment inside the left terminal to initialize interactive, real-time media output here.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}

// Minimal compass icon replacement if needed
function Compass(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
