import React, { useState } from "react";
import { LogEntry } from "../types";
import { Terminal, Trash2, Download, CheckCircle2, AlertTriangle, Cloud, Settings } from "lucide-react";

interface LogViewProps {
  logs: LogEntry[];
  onClearLogs: () => void;
}

export default function LogView({ logs, onClearLogs }: LogViewProps) {
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'HIVEMIND' | 'LOCAL_MODEL' | 'SENSORS' | 'SYSTEM'>('ALL');

  const filteredLogs = logs.filter(log => {
    if (activeFilter === 'ALL') return true;
    return log.source === activeFilter;
  });

  const getLevelStyles = (level: LogEntry['level']) => {
    switch (level) {
      case 'success': return { text: 'text-emerald-400', icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> };
      case 'warn': return { text: 'text-amber-400', icon: <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" /> };
      case 'hivemind': return { text: 'text-indigo-400 font-bold', icon: <Cloud className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> };
      default: return { text: 'text-slate-450', icon: <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" /> };
    }
  };

  const downloadLogs = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(logs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `theorc_companion_telemetry-${new Date().toISOString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl overflow-hidden h-96 justify-between">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-805/60 pb-3.5 gap-3.5">
        <div className="flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-indigo-400" />
          <h2 className="font-sans font-bold text-sm tracking-wide text-slate-100">Synchronized Event Stream</h2>
        </div>
        
        {/* Actions cabinet */}
        <div className="flex items-center gap-2 font-sans font-bold text-[10px]">
          <button
            onClick={downloadLogs}
            className="flex items-center gap-1.5 bg-slate-950 hover:bg-slate-900 text-slate-300 border border-slate-800 hover:border-slate-700 rounded-lg px-2.5 py-1.5 cursor-pointer transition uppercase tracking-wider"
            title="Download JSON Telemetry dump"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Telemetry Dump</span>
          </button>
          
          <button
            onClick={onClearLogs}
            className="flex items-center gap-1.5 bg-rose-950/20 border border-rose-900/40 text-rose-300 hover:bg-rose-900/35 rounded-lg px-2.5 py-1.5 cursor-pointer transition uppercase tracking-wider"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Flush Console</span>
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-xl border border-slate-850 select-none">
        {(['ALL', 'HIVEMIND', 'LOCAL_MODEL', 'SENSORS', 'SYSTEM'] as const).map((filter) => (
          <button
            key={filter}
            onClick={() => setActiveFilter(filter)}
            className={`font-mono text-[9px] font-bold px-3 py-1.5 rounded-lg transition uppercase tracking-wider cursor-pointer flex-1 text-center ${
              activeFilter === filter
                ? 'bg-indigo-950/30 text-indigo-300 shadow-sm border border-indigo-900/40'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {filter.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Actual scrolling events box */}
      <div className="bg-[#030712] border border-slate-900 rounded-xl flex-1 flex flex-col p-4 overflow-y-auto hover:shadow-inner relative h-48">
        {filteredLogs.length > 0 ? (
          <div className="flex flex-col gap-2.5 leading-normal font-mono text-[11px] h-full">
            {filteredLogs.map((log) => {
              const { text, icon } = getLevelStyles(log.level);
              return (
                <div key={log.id} className="flex gap-2.5 hover:bg-slate-900/30 p-1.5 rounded transition">
                  <span className="text-[10px] text-slate-650 shrink-0 font-medium select-none">
                    [{log.timestamp.split('T')[1].substring(0, 8)}]
                  </span>
                  
                  {/* Event source badge */}
                  <span className={`text-[10px] tracking-wide font-bold shrink-0 select-none ${
                    log.source === 'HIVEMIND' ? 'text-indigo-400' :
                    log.source === 'LOCAL_MODEL' ? 'text-indigo-300' :
                    log.source === 'SENSORS' ? 'text-violet-400' :
                    'text-slate-405'
                  }`}>
                    {log.source}:
                  </span>

                  {/* Level icon */}
                  <div className="mt-0.5">{icon}</div>

                  <span className={`${text} flex-1 text-wrap break-all pr-1`}>
                    {log.message}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600 italic select-none gap-2">
            <Terminal className="w-8 h-8 text-slate-800" />
            <span className="font-mono text-xs">No entries match the designated pipeline core...</span>
          </div>
        )}
      </div>
    </div>
  );
}
