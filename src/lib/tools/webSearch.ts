import { decodeHtmlEntities } from "./html";
import { DEFAULT_USER_AGENT, mergeAbortSignals, throttleNetworkRequests } from "./networkPolicy";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  query: string;
  maxResults?: number;
  region?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DDG_HTML_URL = "https://html.duckduckgo.com/html/";

function extractDdgRedirect(href: string) {
  if (!href) return "";
  if (href.startsWith("//")) {
    href = `https:${href}`;
  }
  try {
    const parsed = new URL(href, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (/^https?:\/\//i.test(parsed.toString())) return parsed.toString();
  } catch {
    return "";
  }
  return href;
}

export function parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];
  const blockPattern = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetPattern = /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html)) !== null && links.length < maxResults) {
    const url = extractDdgRedirect(decodeHtmlEntities(match[1]));
    const title = decodeHtmlEntities(stripTags(match[2]).replace(/\s+/g, " ").trim());
    if (url && title) links.push({ url, title });
  }

  const snippets: string[] = [];
  while ((match = snippetPattern.exec(html)) !== null && snippets.length < maxResults) {
    snippets.push(decodeHtmlEntities(stripTags(match[1]).replace(/\s+/g, " ").trim()));
  }

  for (let index = 0; index < links.length; index += 1) {
    results.push({
      title: links[index].title,
      url: links[index].url,
      snippet: snippets[index] ?? "",
    });
  }

  return results;
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, " ");
}

export async function webSearch(options: WebSearchOptions): Promise<WebSearchResult[]> {
  const query = options.query.trim();
  if (!query) {
    throw new Error("Search query is required.");
  }

  const maxResults = Math.min(Math.max(options.maxResults ?? 5, 1), 10);
  const timeoutMs = options.timeoutMs ?? 10_000;

  await throttleNetworkRequests();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal
    ? mergeAbortSignals([options.signal, controller.signal])
    : controller.signal;

  const body = new URLSearchParams({
    q: query,
    kl: options.region ?? "us-en",
  });

  try {
    const response = await fetch(DDG_HTML_URL, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
        "User-Agent": DEFAULT_USER_AGENT,
      },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error(`Search request failed with HTTP ${response.status}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoHtml(html, maxResults);
    if (results.length === 0) {
      throw new Error("No search results were returned. DuckDuckGo may be rate-limiting this device.");
    }
    return results;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error("Web search timed out or was cancelled.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function formatWebSearchForLlm(query: string, results: WebSearchResult[]) {
  const lines = results.map((result, index) => {
    const snippet = result.snippet ? `\n   ${result.snippet}` : "";
    return `${index + 1}. ${result.title}\n   URL: ${result.url}${snippet}`;
  });
  return [`Search query: ${query}`, `Results (${results.length}):`, ...lines].join("\n");
}
