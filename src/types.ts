export interface TaskNode {
  id: string;
  title: string;
  target: 'local_device_slm' | 'hivemind_core';
  agentType: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  actionRequired: string;
  payload: string;
  result?: string;
  processingTimeMs?: number;
}

export interface SensorData {
  latitude: number | null;
  longitude: number | null;
  audioDb: number;
  batteryLevel: number | null;
  timestamp: string;
}

export interface LocalModel {
  id: string;
  name: string;
  size: string;
  speedTps: number; // Tokens per second
  memoryUsageGb: number;
  temperatureSpikeC: number; // degrees Celsius delta
  description: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'success' | 'hivemind';
  source: 'SYSTEM' | 'HIVEMIND' | 'LOCAL_MODEL' | 'SENSORS';
  message: string;
}

export interface SwarmStats {
  connectedNodes: number;
  globalSps: number; // Swarm processed commands per second
  activeMemoryUsageGb: number;
  systemCellRating: 'optimal' | 'throttled' | 'eco';
}
