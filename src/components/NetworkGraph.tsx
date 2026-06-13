import React from "react";
import { TaskNode } from "../types";
import { Server, Smartphone, Cpu, Activity } from "lucide-react";

interface NetworkGraphProps {
  tasks: TaskNode[];
  isOrchestrating: boolean;
  connState: 'connected' | 'connecting' | 'offline' | 'simulating';
}

export default function NetworkGraph({ tasks, isOrchestrating, connState }: NetworkGraphProps) {
  // stable layout for nodes using SVG coordinates
  const hivemindY = 50;
  const hivemindX = 250;

  const cloudAlphaX = 110;
  const cloudAlphaY = 130;

  const cloudBetaX = 390;
  const cloudBetaY = 130;

  const phoneX = 250;
  const phoneY = 240;

  const taskPositions = tasks.map((t, idx) => {
    const count = tasks.length;
    const angle = count > 1 ? -Math.PI + (idx / (count - 1)) * Math.PI : -Math.PI / 2;
    const isLocal = t.target === "local_device_slm";
    const radius = 75;
    const refX = isLocal ? phoneX : hivemindX;
    const refY = isLocal ? phoneY : hivemindY;
    const multiplier = isLocal ? 1 : -0.7;

    const offsetAngle = angle + (isLocal ? 0.5 * Math.PI : -0.5 * Math.PI);

    return {
      id: t.id,
      title: t.title,
      target: t.target,
      status: t.status,
      x: refX + Math.cos(offsetAngle) * radius,
      y: refY + Math.sin(offsetAngle) * radius * multiplier,
    };
  });

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 overflow-hidden shadow-2xl relative h-full flex flex-col justify-between">
      <div className="flex justify-between items-start mb-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-sans text-xs font-bold text-slate-500 uppercase tracking-widest">Swarm Topology</span>
          <div className="flex items-center gap-1.5 mt-1">
            <span className={`w-2 h-2 rounded-full ${
              connState === 'connected' ? 'bg-emerald-500 animate-pulse' :
              connState === 'simulating' ? 'bg-amber-500 animate-pulse' :
              'bg-indigo-500'
            }`} />
            <span className="font-mono text-[10px] uppercase text-slate-400 font-medium">
              Hivemind: {connState.toUpperCase()}
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-sm px-2.5 py-1 rounded-full border border-slate-800">
          <Activity className={`w-3.5 h-3.5 text-indigo-400 ${isOrchestrating ? 'animate-spin' : ''}`} />
          <span className="font-mono text-[9px] uppercase tracking-wider text-indigo-400 font-semibold">
            {isOrchestrating ? "SYNC PULSE" : "LATENCY: 42ms"}
          </span>
        </div>
      </div>

      <div className="w-full flex-1 flex items-center justify-center min-h-[220px]">
        <svg viewBox="0 0 500 320" className="w-full max-w-lg h-full select-none">
          <defs>
            <filter id="glow-indigo" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-royal" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            <filter id="glow-emerald" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* BACKGROUND NETWORK CONNECTORS */}
          <line x1={hivemindX} y1={hivemindY} x2={cloudAlphaX} y2={cloudAlphaY} stroke="#1e293b" strokeWidth="2" />
          <line x1={hivemindX} y1={hivemindY} x2={cloudBetaX} y2={cloudBetaY} stroke="#1e293b" strokeWidth="2" />

          {/* Cloud cores to phone client */}
          <line x1={cloudAlphaX} y1={cloudAlphaY} x2={phoneX} y2={phoneY} stroke="#1e293b" strokeWidth="1.5" />
          <line x1={cloudBetaX} y1={cloudBetaY} x2={phoneX} y2={phoneY} stroke="#1e293b" strokeWidth="1.5" />
          <line x1={hivemindX} y1={hivemindY} x2={phoneX} y2={phoneY} stroke="#4f46e5" strokeWidth="1.5" strokeDasharray="4,6" className="animate-[stroke-dashoffset_12s_linear_infinite]" />

          {/* Path animated packets */}
          {connState !== 'offline' && (
            <>
              <line 
                x1={hivemindX} y1={hivemindY} x2={phoneX} y2={phoneY} 
                stroke="url(#pulse-gradient)" strokeWidth="1.5" 
                strokeDasharray="10, 40" 
                className="animate-[dash_3s_linear_infinite]"
                style={{ strokeDashoffset: '100px' }}
              />
              <style>{`
                @keyframes dash {
                  to {
                    stroke-dashoffset: -100;
                  }
                }
              `}</style>
            </>
          )}

          {/* DYNAMIC TASK CONNECTORS */}
          {taskPositions.map((tp) => {
            const isLocal = tp.target === "local_device_slm";
            const connectX = isLocal ? phoneX : hivemindX;
            const connectY = isLocal ? phoneY : hivemindY;

            let strokeColor = "#334155";
            let strokeWidth = "1";
            let isDash = true;

            if (tp.status === "running") {
              strokeColor = "#6366f1";
              strokeWidth = "2";
              isDash = false;
            } else if (tp.status === "completed") {
              strokeColor = "#10b981";
              strokeWidth = "1.5";
            }

            return (
              <g key={tp.id}>
                <line
                  x1={connectX}
                  y1={connectY}
                  x2={tp.x}
                  y2={tp.y}
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  strokeDasharray={isDash ? "3,3" : "none"}
                  className={tp.status === "running" ? "animate-pulse" : ""}
                />
                
                {/* Moving connection packet for running task */}
                {tp.status === "running" && (
                  <circle r="4" fill="#6366f1" filter="url(#glow-indigo)">
                    <animateMotion
                      dur="1.5s"
                      repeatCount="indefinite"
                      path={`M ${connectX} ${connectY} L ${tp.x} ${tp.y}`}
                    />
                  </circle>
                )}
              </g>
            );
          })}

          {/* STATION STATIONS / NODES */}
          
          {/* Cloud Core Alpha */}
          <g transform={`translate(${cloudAlphaX}, ${cloudAlphaY})`} className="cursor-help group">
            <circle r="16" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
            <Server className="w-4 h-4 text-slate-400 -translate-x-2 -translate-y-2" />
            <text y="28" textAnchor="middle" className="font-mono text-[9px] fill-slate-500 font-medium">Node_Alpha</text>
          </g>

          {/* Cloud Core Beta */}
          <g transform={`translate(${cloudBetaX}, ${cloudBetaY})`} className="cursor-help group">
            <circle r="16" fill="#0f172a" stroke="#1e293b" strokeWidth="2" />
            <Server className="w-4 h-4 text-slate-400 -translate-x-2 -translate-y-2" />
            <text y="28" textAnchor="middle" className="font-mono text-[9px] fill-slate-500 font-medium">Node_Beta</text>
          </g>

          {/* HIVEMIND CORE MAIN NODE */}
          <g transform={`translate(${hivemindX}, ${hivemindY})`} className="cursor-pointer">
            <circle r="32" fill="none" stroke="#4f46e5" strokeWidth="1" className="opacity-40 animate-ping" />
            <circle r="22" fill="#1e1b4b" stroke="#6366f1" strokeWidth="2.5" filter="url(#glow-royal)" className="animate-[pulse_2.5s_infinite]" />
            <Cpu className="w-6.5 h-6.5 text-indigo-300 -translate-x-3.25 -translate-y-3.25" />
            <text y="-32" textAnchor="middle" className="font-sans text-[10px] font-bold tracking-widest fill-indigo-300 uppercase">HIVEMIND</text>
          </g>

          {/* PHONE CLIENT / MOBILE COMPANION COMPONENT */}
          <g transform={`translate(${phoneX}, ${phoneY})`} className="cursor-pointer">
            {tasks.some(t => t.target === 'local_device_slm' && t.status === 'running') && (
              <circle r="28" fill="none" stroke="#6366f1" strokeWidth="1" className="opacity-60 animate-ping" />
            )}
            <circle r="18" fill="#1e1b4b" stroke="#4f46e5" strokeWidth="2" filter="url(#glow-indigo)" />
            <Smartphone className="w-5 h-5 text-indigo-300 -translate-x-2.5 -translate-y-2.5" />
            <text y="30" textAnchor="middle" className="font-sans text-[10px] font-bold tracking-wider fill-indigo-400 uppercase">COMPANION_EDGE</text>
          </g>

          {/* DYNAMIC TASK NODES IN THE SWARM */}
          {taskPositions.map((tp) => {
            const isLocal = tp.target === "local_device_slm";
            
            let fillColor = "#111827";
            let strokeColor = isLocal ? "#4338ca" : "#312e81";
            let iconColor = isLocal ? "text-indigo-400" : "text-slate-400";
            let animatedClass = "";
            let pulseGlow = "";

            if (tp.status === "running") {
              fillColor = "#312e81";
              strokeColor = "#818cf8";
              iconColor = "text-indigo-100";
              animatedClass = "animate-pulse";
              pulseGlow = "url(#glow-indigo)";
            } else if (tp.status === "completed") {
              fillColor = "#064e3b";
              strokeColor = "#34d399";
              iconColor = "text-emerald-300";
              pulseGlow = "url(#glow-emerald)";
            } else if (tp.status === "failed") {
              fillColor = "#7f1d1d";
              strokeColor = "#f87171";
              iconColor = "text-rose-200";
              pulseGlow = "url(#glow-royal)";
            }

            return (
              <g key={tp.id} transform={`translate(${tp.x}, ${tp.y})`} className={`${animatedClass} cursor-help`}>
                <circle r="11" fill={fillColor} stroke={strokeColor} strokeWidth="1.5" filter={pulseGlow} />
                
                {isLocal ? (
                  <Cpu className={`w-3 h-3 ${iconColor} -translate-x-1.5 -translate-y-1.5`} />
                ) : (
                  <Server className={`w-3 h-3 ${iconColor} -translate-x-1.5 -translate-y-1.5`} />
                )}

                <text 
                  y={tp.y > phoneY ? "18" : "-14"} 
                  textAnchor="middle" 
                  className="font-mono text-[9px] fill-slate-400 font-semibold"
                >
                  {tp.title}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Dynamic linear gradient path */}
        <svg className="hidden">
          <defs>
            <linearGradient id="pulse-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#4f46e5" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#312e81" stopOpacity="1" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* Legend */}
      <div className="border-t border-slate-800/50 pt-3.5 mt-2 flex flex-wrap gap-x-5 gap-y-2 items-center justify-center font-mono text-[9px]">
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-800 border border-slate-750" />
          <span>HIVEMIND (Cloud Core)</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-500/20 border border-indigo-500" />
          <span>EMBEDDED EDGE (On-Device)</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500" />
          <span>COMPLETED SOURCE</span>
        </div>
      </div>
    </div>
  );
}
