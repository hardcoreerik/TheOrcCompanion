export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  output: string;
  durationMs: number;
  error?: string;
}

export interface ToolActivityEntry {
  tool: string;
  label: string;
  ok: boolean;
  durationMs: number;
  detail?: string;
}

export interface ToolExecutionContext {
  allowWebSearch: boolean;
  allowPrivateHosts: boolean;
  signal?: AbortSignal;
  device: import("../tools/deviceTools").DeviceToolContext;
  hive: import("../tools/hiveTools").HiveToolsConfig;
}

export interface ToolDefinition {
  name: string;
  description: string;
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<string>;
}

export interface AgentLoopOptions {
  userMessage: string;
  transcript: import("../localLlm").LocalTranscriptMessage[];
  deviceContext: import("../localLlm").LocalTranscriptMessage | null;
  maxRounds?: number;
  allowWebSearch: boolean;
  allowPrivateHosts: boolean;
  signal?: AbortSignal;
  device: import("../tools/deviceTools").DeviceToolContext;
  hive: import("../tools/hiveTools").HiveToolsConfig;
  runTurn: (
    conversationId: string,
    message: string,
    transcript: import("../localLlm").LocalTranscriptMessage[],
    options?: { temperature?: number },
  ) => Promise<string>;
  onPartialText?: (text: string) => void;
  onToolActivity?: (entry: ToolActivityEntry) => void;
  onStatus?: (status: string) => void;
}

export interface AgentLoopResult {
  finalText: string;
  toolActivity: ToolActivityEntry[];
  rounds: number;
  usedTools: boolean;
  fallbackNotice?: string;
}
