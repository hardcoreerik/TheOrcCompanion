import type { LocalTranscriptMessage } from "../localLlm";
import { isLikelyFinalAnswer, parseToolCalls, stripToolCalls } from "./parseToolCalls";
import { buildAgentSystemPrompt, buildToolResultMessage } from "./systemPrompt";
import { executeTool, toolActivityLabel } from "./toolRegistry";
import type { AgentLoopOptions, AgentLoopResult, ToolActivityEntry, ToolExecutionContext } from "./types";

const DEFAULT_MAX_ROUNDS = 5;

function appendTranscript(
  transcript: LocalTranscriptMessage[],
  role: LocalTranscriptMessage["role"],
  text: string,
) {
  return [...transcript, { role, text, timestamp: new Date().toISOString() }];
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const maxRounds = options.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const toolActivity: ToolActivityEntry[] = [];
  let parseFailures = 0;
  let usedTools = false;
  let fallbackNotice: string | undefined;

  const agentSystem: LocalTranscriptMessage = {
    role: "system",
    text: buildAgentSystemPrompt(),
    timestamp: new Date().toISOString(),
  };

  let workingTranscript = options.deviceContext
    ? [options.deviceContext, agentSystem, ...options.transcript]
    : [agentSystem, ...options.transcript];

  const executionContext: ToolExecutionContext = {
    allowWebSearch: options.allowWebSearch,
    allowPrivateHosts: options.allowPrivateHosts,
    signal: options.signal,
    device: options.device,
    hive: options.hive,
  };

  let finalText = "";
  let rounds = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    if (options.signal?.aborted) {
      throw new Error("Agent run was cancelled.");
    }

    rounds = round + 1;
    options.onStatus?.(round === 0 ? "Thinking..." : "Continuing...");

    const response = await options.runTurn(
      `agent-${Date.now()}-${round}`,
      round === 0 ? options.userMessage : "Continue using any tool results above and answer the user.",
      workingTranscript,
      { temperature: round === 0 ? 0.7 : 0.5 },
    );

    if (options.signal?.aborted) {
      throw new Error("Agent run was cancelled.");
    }

    const toolCalls = parseToolCalls(response);
    if (toolCalls.length === 0) {
      finalText = stripToolCalls(response) || response.trim();
      options.onPartialText?.(finalText);
      break;
    }

    usedTools = true;
    workingTranscript = appendTranscript(workingTranscript, "assistant", response);
    options.onPartialText?.(stripToolCalls(response));

    for (const call of toolCalls) {
      if (options.signal?.aborted) {
        throw new Error("Agent run was cancelled.");
      }

      const startedMs = Date.now();
      const label = toolActivityLabel(call.tool, call.args);
      options.onStatus?.(label);

      try {
        const output = await executeTool(call.tool, call.args, executionContext);
        const durationMs = Date.now() - startedMs;
        const entry: ToolActivityEntry = { tool: call.tool, label, ok: true, durationMs };
        toolActivity.push(entry);
        options.onToolActivity?.(entry);
        workingTranscript = appendTranscript(
          workingTranscript,
          "user",
          buildToolResultMessage(call.tool, output),
        );
      } catch (error: any) {
        const durationMs = Date.now() - startedMs;
        const message = error?.message || "Tool execution failed.";
        const entry: ToolActivityEntry = {
          tool: call.tool,
          label,
          ok: false,
          durationMs,
          detail: message,
        };
        toolActivity.push(entry);
        options.onToolActivity?.(entry);
        workingTranscript = appendTranscript(
          workingTranscript,
          "user",
          buildToolResultMessage(call.tool, `Error: ${message}`),
        );
      }
    }

    if (round === maxRounds - 1) {
      finalText = stripToolCalls(response) || "I hit the tool limit before finishing. Try a narrower question.";
      break;
    }
  }

  if (!finalText) {
    parseFailures += 1;
    if (parseFailures >= 2) {
      fallbackNotice = "Agent tools were unavailable for this answer, so I replied without them.";
    }
    finalText = "I couldn't finish that request with the available tools.";
  }

  if (usedTools && !isLikelyFinalAnswer(finalText) && rounds >= maxRounds) {
    finalText = stripToolCalls(finalText) || finalText;
  }

  return {
    finalText,
    toolActivity,
    rounds,
    usedTools,
    fallbackNotice,
  };
}
