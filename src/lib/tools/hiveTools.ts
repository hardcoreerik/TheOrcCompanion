export interface HiveRouteInput {
  host: string;
  hiveInfoUrl: string;
  ollamaUrl: string;
}

export interface HiveToolsConfig {
  apiBase: string;
  activeRoute: HiveRouteInput | null;
}

function resolveApiUrl(apiBase: string, path: string) {
  const base = apiBase.replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export async function probeHiveRoute(config: HiveToolsConfig, targetHost?: string) {
  const host = targetHost?.trim() || config.activeRoute?.host;
  if (!host) {
    return "No HIVE route is selected. Open the Hive tab and choose a route first.";
  }

  try {
    const response = await fetch(resolveApiUrl(config.apiBase, "/api/hive/test-connection"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: host }),
    });
    if (!response.ok) {
      return `HIVE probe failed with HTTP ${response.status}. The companion server may be unavailable on this build.`;
    }

    const result = await response.json();
    const lines = [
      `Status: ${result.status ?? "unknown"}`,
      `Latency: ${result.latency ?? 0} ms`,
      result.hiveNode?.Name ? `HIVE node: ${result.hiveNode.Name}` : "HIVE node: unavailable",
      `Ollama reachable: ${result.ollama?.reachable ? "yes" : "no"}`,
      `Ollama models: ${result.ollama?.modelCount ?? 0}`,
      ...(Array.isArray(result.testLog) ? result.testLog.slice(0, 4).map((entry: string) => `- ${entry}`) : []),
    ];
    return lines.join("\n");
  } catch (error: any) {
    return `HIVE probe unavailable: ${error?.message || "network error"}. Packaged Android builds need a dev server or VITE_API_BASE for HIVE tools.`;
  }
}

export async function queueScrapeUrlJob(config: HiveToolsConfig, url: string) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Provide a full http:// or https:// URL.");
  }

  try {
    const response = await fetch(resolveApiUrl(config.apiBase, "/api/companion-node/jobs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "scrape_url", input: { url: trimmed } }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.error || `Job queue returned HTTP ${response.status}`);
    }
    const job = await response.json();
    return `Queued scrape job ${job.id ?? "unknown"} for ${trimmed}. Check the Jobs tab for completion.`;
  } catch (error: any) {
    throw new Error(error?.message || "Unable to queue scrape job.");
  }
}
