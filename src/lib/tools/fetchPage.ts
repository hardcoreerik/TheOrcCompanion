import { decodeHtmlEntities, stripHtml, summarizeText } from "./html";
import { assertPublicHttpUrl, DEFAULT_USER_AGENT, mergeAbortSignals, throttleNetworkRequests } from "./networkPolicy";

export interface FetchPageOptions {
  url: string;
  timeoutMs?: number;
  maxTextSampleChars?: number;
  allowPrivateHosts?: boolean;
  signal?: AbortSignal;
}

export interface FetchPageResult {
  url: string;
  title: string;
  summary: string;
  textSample: string;
  textLength: number;
  linkCount: number;
}

export async function fetchPage(options: FetchPageOptions): Promise<FetchPageResult> {
  const url = assertPublicHttpUrl(options.url, options.allowPrivateHosts);
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxTextSampleChars = options.maxTextSampleChars ?? 4000;

  await throttleNetworkRequests();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? mergeAbortSignals([options.signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": DEFAULT_USER_AGENT,
      },
    });

    if (!response.ok) {
      throw new Error(`Target responded with HTTP ${response.status}`);
    }

    const html = await response.text();
    const text = stripHtml(html);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = decodeHtmlEntities(titleMatch?.[1]?.replace(/\s+/g, " ").trim() || new URL(url).hostname);
    const summary = summarizeText(text);
    const linkCount = (html.match(/<a\b/gi) ?? []).length;

    return {
      url,
      title,
      summary,
      textSample: text.slice(0, maxTextSampleChars),
      textLength: text.length,
      linkCount,
    };
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Page fetch timed out or was cancelled.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function formatFetchPageForLlm(result: FetchPageResult) {
  return [
    `URL: ${result.url}`,
    `Title: ${result.title}`,
    `Summary: ${result.summary}`,
    `Content sample (${result.textLength} chars total):`,
    result.textSample,
  ].join("\n");
}
