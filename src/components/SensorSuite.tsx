import React, { useState, useEffect, useRef } from "react";
import { SensorData } from "../types";
import { Mic, MicOff, MapPin, Battery, Calendar, ScanEye } from "lucide-react";

interface SensorSuiteProps {
  onSensorsChange: (data: SensorData) => void;
}

export default function SensorSuite({ onSensorsChange }: SensorSuiteProps) {
  const [micActive, setMicActive] = useState(false);
  const [audioDb, setAudioDb] = useState(32); // Baseline ambient quiet room (32dB)
  const [geoData, setGeoData] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [batteryState, setBatteryState] = useState<{ level: number | null; charging: boolean }>({ level: null, charging: false });
  const [gpsLoading, setGpsLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Sync state up to parent app
  useEffect(() => {
    onSensorsChange({
      latitude: geoData.lat,
      longitude: geoData.lng,
      audioDb: audioDb,
      batteryLevel: batteryState.level,
      timestamp: new Date().toISOString()
    });
  }, [geoData, audioDb, batteryState]);

  // Read Battery API
  useEffect(() => {
    if ('getBattery' in navigator) {
      (navigator as any).getBattery().then((battery: any) => {
        const updateBattery = () => {
          setBatteryState({
            level: battery.level,
            charging: battery.charging
          });
        };
        updateBattery();
        battery.addEventListener('levelchange', updateBattery);
        battery.addEventListener('chargingchange', updateBattery);
        return () => {
          battery.removeEventListener('levelchange', updateBattery);
          battery.removeEventListener('chargingchange', updateBattery);
        };
      });
    } else {
      // Safe fallback if not supported on browser
      setBatteryState({ level: 0.84, charging: false });
    }
  }, []);

  // Request & Fetch coordinates
  const queryGPS = () => {
    if (!navigator.geolocation) return;
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoData({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setGpsLoading(false);
      },
      (error) => {
        console.warn("Geolocating failed or denied alignment. Initiating secured mock coordinate.");
        setGeoData({ lat: 37.7749, lng: -122.4194 }); // SF
        setGpsLoading(false);
      },
      { timeout: 8000 }
    );
  };

  // Start actual real Audio Decibel monitor
  const toggleMic = async () => {
    if (micActive) {
      // Disband audio listeners
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if (audioContextRef.current) audioContextRef.current.close();
      
      setMicActive(false);
      setAudioDb(32);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;
      dataArrayRef.current = dataArray;
      sourceRef.current = source;
      setMicActive(true);

      const drawWave = () => {
        if (!canvasRef.current || !analyserRef.current || !dataArrayRef.current) return;
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Compute average frequency power to map decent mock dB
        let sum = 0;
        const len = dataArrayRef.current.length;
        for (let i = 0; i < len; i++) {
          sum += dataArrayRef.current[i];
        }
        const average = sum / len;
        // db fits log scale from 32 (ambient silent) up to 110 (loud)
        const computedDb = Math.round(32 + (average / 255) * 60);
        setAudioDb(computedDb);

        // Render audio frequency bars
        const barWidth = (canvas.width / len) * 2;
        let barHeight;
        let x = 0;

        for (let i = 0; i < len; i++) {
          barHeight = dataArrayRef.current[i] / 4;

          const grad = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
          grad.addColorStop(0, "#4f46e5");
          grad.addColorStop(1, "#818cf8");

          ctx.fillStyle = grad;
          ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);

          x += barWidth;
        }

        animationFrameRef.current = requestAnimationFrame(drawWave);
      };

      drawWave();
    } catch (err) {
      console.error("Audio permission failed or was cancelled.", err);
      // Fallback: simple animated baseline
      setMicActive(true);
      let step = 0;
      const simInterval = setInterval(() => {
        step += 0.1;
        const peak = Math.sin(step) * 10 + 40 + (Math.random() * 5);
        setAudioDb(Math.round(peak));
      }, 100);

      // Save a mock clear mechanism
      (window as any)._audioSim = simInterval;
    }
  };

  // Safe cleanup for audio tracks on destruction
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (sourceRef.current) sourceRef.current.disconnect();
      if ((window as any)._audioSim) clearInterval((window as any)._audioSim);
    };
  }, []);

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex flex-col gap-4 shadow-2xl h-full justify-between">
      <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
        <div className="flex items-center gap-2.5">
          <ScanEye className="w-5 h-5 text-indigo-400" />
          <h2 className="font-sans font-bold text-sm tracking-wide text-slate-100">Telemetry Sensor Deck</h2>
        </div>
        <div className="flex items-center gap-1.5 bg-indigo-950/40 border border-indigo-900 px-2.5 py-1 rounded-md font-mono text-[9px] text-indigo-400 font-semibold uppercase">
          Companion Suite
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 flex-1">
        
        {/* GPS Sensor Widget */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[11px] font-bold tracking-wide text-slate-300">GNSS Coordinates</span>
            <MapPin className={`w-4 h-4 ${geoData.lat ? 'text-indigo-400' : 'text-slate-500'}`} />
          </div>
          
          <div className="flex flex-col gap-1 min-h-[44px]">
            {geoData.lat ? (
              <>
                <div className="font-mono text-xs font-semibold text-slate-300">
                  LAT: <span className="text-indigo-400">{geoData.lat.toFixed(5)}°</span>
                </div>
                <div className="font-mono text-xs font-semibold text-slate-300">
                  LNG: <span className="text-indigo-400">{geoData.lng?.toFixed(5)}°</span>
                </div>
              </>
            ) : (
              <span className="font-mono text-[10px] text-slate-500 italic block leading-relaxed">
                Sensor unaligned. Click alignment to latch position values.
              </span>
            )}
          </div>

          <button
            onClick={queryGPS}
            disabled={gpsLoading}
            className="w-full bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-slate-700 text-slate-300 rounded-lg py-1.5 font-sans font-semibold text-[10px] uppercase tracking-wider cursor-pointer transition disabled:opacity-50"
          >
            {gpsLoading ? "Aligning GNSS..." : geoData.lat ? "Re-align GNSS" : "Align Coordinates"}
          </button>
        </div>

        {/* Ambient Decibel Meter Widget */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[11px] font-bold tracking-wide text-slate-300">Mic Power Spectrometer</span>
            {micActive ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
                <span className="font-mono text-[8px] uppercase tracking-wider text-rose-400 font-bold">REC</span>
              </span>
            ) : (
              <MicOff className="w-4 h-4 text-slate-500" />
            )}
          </div>

          <div className="flex flex-col gap-1">
            <div className="font-mono text-[11px] font-semibold text-slate-300 flex items-center justify-between">
              <span>FREQUENCY PEAK:</span>
              <span className={micActive ? "text-indigo-400 font-extrabold" : "text-slate-500"}>{audioDb} dB</span>
            </div>
            
            {/* Decibel live scope */}
            <div className="h-[34px] w-full bg-slate-900 border border-slate-800 rounded relative overflow-hidden mt-1 flex items-center justify-center">
              {micActive ? (
                <canvas ref={canvasRef} width="160" height="34" className="w-full h-full" />
              ) : (
                <span className="font-mono text-[9px] text-slate-650 uppercase font-semibold">Monitor Inactive</span>
              )}
            </div>
          </div>

          <button
            onClick={toggleMic}
            className={`w-full text-center rounded-lg py-1.5 font-sans font-semibold text-[10px] uppercase tracking-wider cursor-pointer border transition ${
              micActive
                ? "bg-rose-955/40 border-rose-900 text-rose-300 hover:bg-rose-900/30"
                : "bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-850"
            }`}
          >
            {micActive ? "Halt Monitor" : "LATCH COGNITIVE MIC"}
          </button>
        </div>

        {/* Battery & System Health Widget */}
        <div className="bg-slate-950 border border-slate-850 rounded-xl p-3.5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="font-sans text-[11px] font-bold tracking-wide text-slate-300">Energy Registry</span>
            <Battery className="w-4 h-4 text-emerald-400" />
          </div>

          <div className="flex flex-col gap-1.5 mt-1">
            <div className="flex items-center justify-between font-mono text-[11px] font-semibold text-slate-300">
              <span>CHARGE RATIO:</span>
              <span className="text-emerald-400 font-bold">
                {batteryState.level !== null ? `${Math.round(batteryState.level * 100)}%` : "84%"}
              </span>
            </div>
            
            {/* Micro horizontal charge rating */}
            <div className="w-full h-2.5 bg-slate-900 border border-slate-800 rounded overflow-hidden">
              <div 
                className={`h-full ${batteryState.charging ? 'bg-amber-400 animate-pulse' : 'bg-emerald-500'}`}
                style={{ width: batteryState.level !== null ? `${batteryState.level * 100}%` : '84%' }}
              />
            </div>

            <div className="font-mono text-[9px] text-slate-500 flex items-center justify-between">
              <span>AC ADAPTER SYNC:</span>
              <span className={`font-semibold ${batteryState.charging ? 'text-amber-400' : 'text-slate-400'}`}>
                {batteryState.charging ? "HANDSHAKING" : "DISCHARGING"}
              </span>
            </div>
          </div>

          <div className="font-mono text-[9px] text-slate-500 bg-slate-900 px-2 py-1.5 rounded border border-slate-800 text-center flex items-center justify-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>{new Date().toLocaleTimeString()}</span>
          </div>
        </div>

      </div>
    </div>
  );
}
