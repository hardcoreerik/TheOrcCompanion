import { Capacitor, registerPlugin, WebPlugin } from "@capacitor/core";

export type BackendId = "litert" | "mlc";
export type BackendPolicy = "auto" | "litert" | "mlc";
export type ChatRole = "user" | "assistant" | "system";

export interface DeviceProfile {
  manufacturer: string;
  model: string;
  device: string;
  deviceLabel?: string;
  androidVersion: string;
  sdkInt: number;
  totalRamBytes: number;
  availableRamBytes: number;
  storageFreeBytes: number;
  batteryPercent: number;
  charging: boolean;
  recommended: boolean;
  localTimeIso?: string;
  timezoneId?: string;
  ownerName?: string;
  contactsPermission?: "granted" | "denied" | "prompt" | string;
}

export interface BackendRecord {
  id: BackendId;
  label: string;
  available: boolean;
  supportsGpu: boolean;
  supportsOffline: boolean;
  experimental: boolean;
  reason?: string;
}

export interface LocalModelRecord {
  id: string;
  name: string;
  filename: string;
  url: string;
  sha256: string;
  recommended: boolean;
  downloaded: boolean;
  loaded: boolean;
  backend?: string;
  backendId: BackendId;
  supportsMultiTurn: boolean;
  supportsStreaming: boolean;
  supportsGpu: boolean;
  supportsOffline: boolean;
  experimental: boolean;
  downloadSizeBytes: number;
  bytes: number;
  path: string;
}

export interface ModelListResponse {
  models: LocalModelRecord[];
}

export interface BackendListResponse {
  backends: BackendRecord[];
}

export interface RuntimeStatus {
  loaded: boolean;
  activeModelId?: string;
  activeBackendId?: BackendId;
  activeBackendLabel?: string;
  supportsMultiTurn: boolean;
  supportsStreaming: boolean;
}

export interface DownloadProgress {
  modelId: string;
  backendId: BackendId;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
}

export interface ModelLoadState {
  modelId: string;
  backendId: BackendId;
  phase: "downloading" | "downloaded" | "loading" | "loaded" | "gpu_fallback" | "unloaded" | string;
  state: string;
  backend?: string;
  message?: string;
  recoverable?: boolean;
  errorCode?: string;
}

export interface TokenEvent {
  conversationId: string;
  backendId: BackendId;
  modelId: string;
  token: string;
}

export interface GenerationDone {
  conversationId: string;
  backendId?: BackendId;
  modelId?: string;
  cancelled?: boolean;
}

export interface GenerationCancelled {
  conversationId: string;
  backendId?: BackendId;
  modelId?: string;
  cancelled: true;
}

export interface RuntimeError {
  modelId?: string;
  backendId?: BackendId;
  conversationId?: string;
  message: string;
  recoverable?: boolean;
  errorCode?: string;
}

export interface BackendSwitchEvent {
  fromBackendId?: BackendId;
  toBackendId: BackendId;
  reason: string;
}

export interface LaunchArgs {
  runSoakTest: boolean;
  backendId?: BackendId;
  modelId?: string;
  scriptId?: string;
}

export interface LocalTranscriptMessage {
  id?: string;
  role: ChatRole;
  text: string;
  timestamp?: string;
  backendId?: BackendId;
  modelId?: string;
  status?: "streaming" | "error";
}

export interface SoakTurnResult {
  prompt: string;
  response: string;
  durationMs: number;
}

export interface SoakTestResult {
  scriptId: string;
  passed: boolean;
  backendId: BackendId;
  modelId: string;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  turnCount: number;
  rememberedFirstAnswer: boolean;
  firstAnswer: string;
  finalAnswer: string;
  failureReason?: string;
  turns: SoakTurnResult[];
  errors: string[];
  agentWebSearchPassed?: boolean;
  agentWebSearchAnswer?: string;
}

export interface LocalLlmPlugin {
  getDeviceProfile(): Promise<DeviceProfile>;
  requestContactsAccess(): Promise<{ granted: boolean; ownerName?: string; contactsPermission?: string }>;
  getOwnerProfile(): Promise<{ ownerName?: string; contactsPermission?: string }>;
  listBackends(): Promise<BackendListResponse>;
  listModels(): Promise<ModelListResponse>;
  getRuntimeStatus(): Promise<RuntimeStatus>;
  getLaunchArgs(): Promise<LaunchArgs>;
  getLastSoakTestResult(): Promise<{ exists: boolean; rawJson?: string }>;
  saveSoakTestResult(options: { rawJson: string }): Promise<{ saved: boolean; path?: string }>;
  downloadModel(options: { modelId: string }): Promise<{ started: boolean; modelId: string; backendId: BackendId }>;
  loadModel(options: { modelId: string; backendId?: BackendId }): Promise<{ started: boolean; modelId: string; backendId: BackendId }>;
  startGeneration(options: {
    conversationId: string;
    message: string;
    transcript?: LocalTranscriptMessage[];
    modelId?: string;
    backendId?: BackendId;
    options?: Record<string, unknown>;
  }): Promise<{ started: boolean; conversationId: string; modelId: string; backendId: BackendId }>;
  sendMessage(options: {
    conversationId: string;
    message: string;
    transcript?: LocalTranscriptMessage[];
    modelId?: string;
    backendId?: BackendId;
    options?: Record<string, unknown>;
  }): Promise<{ started: boolean; conversationId: string; modelId: string; backendId: BackendId }>;
  cancelGeneration(options: { conversationId: string }): Promise<{ cancelled: boolean; conversationId: string }>;
  unloadModel(): Promise<{ unloaded: boolean }>;
  deleteModel(options: { modelId: string }): Promise<{ deleted: boolean; modelId: string }>;
  addListener(eventName: "downloadProgress", listenerFunc: (event: DownloadProgress) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "loadState", listenerFunc: (event: ModelLoadState) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "token", listenerFunc: (event: TokenEvent) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "generationDone", listenerFunc: (event: GenerationDone) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "generationCancelled", listenerFunc: (event: GenerationCancelled) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "runtimeError", listenerFunc: (event: RuntimeError) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(eventName: "backendSwitch", listenerFunc: (event: BackendSwitchEvent) => void): Promise<{ remove: () => Promise<void> }>;
}

class LocalLlmWeb extends WebPlugin implements LocalLlmPlugin {
  async getDeviceProfile(): Promise<DeviceProfile> {
    return {
      manufacturer: "Browser",
      model: "Web preview",
      device: "web",
      deviceLabel: "Web preview",
      androidVersion: "n/a",
      sdkInt: 0,
      totalRamBytes: 0,
      availableRamBytes: 0,
      storageFreeBytes: 0,
      batteryPercent: -1,
      charging: false,
      recommended: false,
      localTimeIso: new Date().toISOString(),
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  }

  async listBackends(): Promise<BackendListResponse> {
    return {
      backends: [
        {
          id: "litert",
          label: "LiteRT-LM",
          available: false,
          supportsGpu: false,
          supportsOffline: false,
          experimental: false,
          reason: "Open the Android build to use local inference.",
        },
        {
          id: "mlc",
          label: "MLC Android",
          available: false,
          supportsGpu: false,
          supportsOffline: false,
          experimental: true,
          reason: "Open the Android build to use local inference.",
        },
      ],
    };
  }

  async listModels(): Promise<ModelListResponse> {
    return {
      models: [],
    };
  }

  async getRuntimeStatus(): Promise<RuntimeStatus> {
    return {
      loaded: false,
      supportsMultiTurn: false,
      supportsStreaming: false,
    };
  }

  async getLaunchArgs(): Promise<LaunchArgs> {
    return { runSoakTest: false };
  }

  async requestContactsAccess(): Promise<{ granted: boolean; ownerName?: string; contactsPermission?: string }> {
    return { granted: false, contactsPermission: "denied" };
  }

  async getOwnerProfile(): Promise<{ ownerName?: string; contactsPermission?: string }> {
    return { contactsPermission: "denied" };
  }

  async getLastSoakTestResult() {
    return { exists: false };
  }

  async saveSoakTestResult() {
    return { saved: false };
  }

  async downloadModel(): Promise<{ started: boolean; modelId: string; backendId: BackendId }> {
    throw new Error("Model download is only available in the Android app.");
  }

  async loadModel(): Promise<{ started: boolean; modelId: string; backendId: BackendId }> {
    throw new Error("Native model loading is only available in the Android app.");
  }

  async startGeneration(_options: {
    conversationId: string;
    message: string;
    transcript?: LocalTranscriptMessage[];
    modelId?: string;
    backendId?: BackendId;
    options?: Record<string, unknown>;
  }): Promise<{ started: boolean; conversationId: string; modelId: string; backendId: BackendId }> {
    throw new Error("Local inference requires the Android native backend.");
  }

  async sendMessage(options: {
    conversationId: string;
    message: string;
    transcript?: LocalTranscriptMessage[];
    modelId?: string;
    backendId?: BackendId;
    options?: Record<string, unknown>;
  }) {
    return this.startGeneration(options);
  }

  async cancelGeneration(options: { conversationId: string }) {
    return { cancelled: true, conversationId: options.conversationId };
  }

  async unloadModel() {
    return { unloaded: true };
  }

  async deleteModel(options: { modelId: string }) {
    return { deleted: false, modelId: options.modelId };
  }
}

export const LocalLlm = registerPlugin<LocalLlmPlugin>("LocalLlm", {
  web: () => new LocalLlmWeb(),
});

export function isNativeLocalLlmAvailable() {
  return Capacitor.isNativePlatform();
}

export function formatBytes(bytes: number) {
  if (!bytes || bytes < 0) return "Unknown";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
