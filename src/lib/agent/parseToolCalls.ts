import type { ToolCall } from "./types";

const TOOL_JSON_PATTERN = /\{"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{[\s\S]*?\})\s*\}/g;

function tryParseToolJson(raw: string): ToolCall | null {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.tool === "string" && parsed.args && typeof parsed.args === "object") {
      return { tool: parsed.tool, args: parsed.args as Record<string, unknown> };
    }
  } catch {
    return null;
  }
  return null;
}

function extractJsonObjects(text: string) {
  const matches: string[] = [];
  const fenced = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fenced) {
    const body = match[1]?.trim();
    if (body) matches.push(body);
  }

  let depth = 0;
  let start = -1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        matches.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return matches;
}

export function parseToolCalls(text: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const seen = new Set<string>();

  for (const block of extractJsonObjects(text)) {
    const parsed = tryParseToolJson(block);
    if (!parsed) continue;
    const key = `${parsed.tool}:${JSON.stringify(parsed.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(parsed);
  }

  let regexMatch: RegExpExecArray | null;
  while ((regexMatch = TOOL_JSON_PATTERN.exec(text)) !== null) {
    const parsed = tryParseToolJson(regexMatch[0]);
    if (!parsed) continue;
    const key = `${parsed.tool}:${JSON.stringify(parsed.args)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    calls.push(parsed);
  }

  return calls;
}

export function stripToolCalls(text: string) {
  let cleaned = text.replace(/```(?:json)?\s*\{[\s\S]*?"tool"[\s\S]*?\}\s*```/gi, "");
  cleaned = cleaned.replace(/\{"tool"\s*:\s*"[^"]+"\s*,\s*"args"\s*:\s*\{[\s\S]*?\}\s*\}/g, "");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

export function isLikelyFinalAnswer(text: string) {
  return parseToolCalls(text).length === 0;
}
