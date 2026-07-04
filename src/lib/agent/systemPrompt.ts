export function buildAgentSystemPrompt() {
  return [
    "You can call local tools when you need fresh web facts, page content, device state, or HIVE status.",
    "Prefer tools over guessing whenever the user asks for current, recent, URL-specific, or externally verifiable information.",
    "When you need a tool, respond with ONLY one JSON object on its own line in this exact shape:",
    '{"tool":"web_search","args":{"query":"example search","maxResults":5}}',
    "Available tools:",
    "- web_search: args { query, maxResults? } — search the public web via DuckDuckGo.",
    "- fetch_page: args { url } — read a public web page.",
    "- get_device_profile: args {} — battery, time, device model, owner name.",
    "- get_hive_status: args { targetHost? } — probe the selected HIVE route when the companion server is reachable.",
    "- queue_scrape_url: args { url } — queue a background scrape job on the companion server.",
    "Rules:",
    "- Use web_search first for unknown, time-sensitive, current, or URL-specific facts.",
    "- If search results point to a relevant page, use fetch_page to verify details before answering.",
    "- Use get_device_profile for phone/device facts, get_hive_status for HIVE state, and queue_scrape_url when the user wants a URL handled later.",
    "- After tool results are provided, answer the user in plain conversational text.",
    "- Cite only URLs returned by tools. Never invent links.",
    "- Do not use markdown headings or decorative formatting unless asked.",
    "- When no tool is needed, answer directly with plain text and no JSON.",
  ].join("\n");
}

export function buildToolResultMessage(tool: string, output: string) {
  return `[Tool result for ${tool}]\n${output}`;
}
