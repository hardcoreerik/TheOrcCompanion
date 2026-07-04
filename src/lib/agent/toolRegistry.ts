import { getDeviceProfileSnapshot } from "../tools/deviceTools";
import { formatFetchPageForLlm, fetchPage } from "../tools/fetchPage";
import { probeHiveRoute, queueScrapeUrlJob } from "../tools/hiveTools";
import { formatWebSearchForLlm, webSearch } from "../tools/webSearch";
import { LocalLlm } from "../localLlm";
import type { ToolDefinition, ToolExecutionContext } from "./types";

function readStringArg(args: Record<string, unknown>, key: string, fallback = "") {
  const value = args[key];
  return typeof value === "string" ? value.trim() : fallback;
}

function readNumberArg(args: Record<string, unknown>, key: string, fallback: number) {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "web_search",
    description: "Search the public web via DuckDuckGo.",
    execute: async (args, context) => {
      if (!context.allowWebSearch) {
        throw new Error("Web search is disabled or blocked on metered network.");
      }
      const query = readStringArg(args, "query");
      const maxResults = readNumberArg(args, "maxResults", 5);
      const results = await webSearch({ query, maxResults, signal: context.signal });
      return formatWebSearchForLlm(query, results);
    },
  },
  {
    name: "fetch_page",
    description: "Fetch and summarize a public web page.",
    execute: async (args, context) => {
      if (!context.allowWebSearch) {
        throw new Error("Page fetch is disabled or blocked on metered network.");
      }
      const url = readStringArg(args, "url");
      const result = await fetchPage({
        url,
        allowPrivateHosts: context.allowPrivateHosts,
        signal: context.signal,
      });
      return formatFetchPageForLlm(result);
    },
  },
  {
    name: "get_device_profile",
    description: "Return current device profile information.",
    execute: async (_args, context) => getDeviceProfileSnapshot(context.device),
  },
  {
    name: "get_hive_status",
    description: "Probe the selected HIVE route.",
    execute: async (args, context) => probeHiveRoute(context.hive, readStringArg(args, "targetHost")),
  },
  {
    name: "queue_scrape_url",
    description: "Queue a companion scrape job for a URL.",
    execute: async (args, context) => queueScrapeUrlJob(context.hive, readStringArg(args, "url")),
  },
  {
    name: "device_action",
    description: "Request a user-confirmed Android action.",
    execute: async (args) => {
      const action = readStringArg(args, "action");
      if (!["set_alarm", "draft_message", "create_calendar", "open_app"].includes(action)) {
        throw new Error("Unsupported device action.");
      }
      const payload = args.payload && typeof args.payload === "object" ? args.payload as Record<string, unknown> : {};
      const approved = window.confirm(`Allow TheOrc Companion to ${action.replaceAll("_", " ")}?\n\n${JSON.stringify(payload, null, 2)}`);
      if (!approved) return "The user declined the Android action.";
      const result = await LocalLlm.performDeviceAction({ action, payload, confirmed: true });
      return result.detail;
    },
  },
];

const TOOL_MAP = new Map(TOOL_DEFINITIONS.map((tool) => [tool.name, tool]));

export function listToolDefinitions() {
  return TOOL_DEFINITIONS.map(({ name, description }) => ({ name, description }));
}

export async function executeTool(name: string, args: Record<string, unknown>, context: ToolExecutionContext) {
  const tool = TOOL_MAP.get(name);
  if (!tool) {
    throw new Error(`Unknown tool: ${name}`);
  }
  return tool.execute(args, context);
}

export function toolActivityLabel(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "web_search":
      return `Searching: ${readStringArg(args, "query", "web")}`;
    case "fetch_page":
      return `Reading: ${readStringArg(args, "url", "page")}`;
    case "get_device_profile":
      return "Reading device profile";
    case "get_hive_status":
      return "Probing HIVE route";
    case "queue_scrape_url":
      return `Queue scrape: ${readStringArg(args, "url", "url")}`;
    case "device_action":
      return `Confirm Android action: ${readStringArg(args, "action", "action")}`;
    default:
      return name;
  }
}
