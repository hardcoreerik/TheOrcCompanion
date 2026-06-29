const PRIVATE_IPV4 =
  /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;

let lastRequestAt = 0;
const MIN_INTERVAL_MS = 2000;

export function assertPublicHttpUrl(url: string, allowPrivateHosts = false) {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Only http:// and https:// URLs are allowed.");
  }

  const parsed = new URL(trimmed);
  if (!allowPrivateHosts) {
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || PRIVATE_IPV4.test(`${host}.`)) {
      throw new Error("Private or local network URLs are blocked.");
    }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported URL protocol.");
  }

  return parsed.toString();
}

export async function throttleNetworkRequests() {
  const now = Date.now();
  const waitMs = MIN_INTERVAL_MS - (now - lastRequestAt);
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAt = Date.now();
}

export const DEFAULT_USER_AGENT = "TheOrcCompanion/1.0 (+local-agent-tools)";

export function mergeAbortSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}
