export function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function summarizeText(text: string, maxChars = 320) {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const sentences = trimmed.match(/[^.!?]+[.!?]+/g) ?? [];
  let summary = "";
  for (const sentence of sentences) {
    if ((summary + sentence).length > maxChars) break;
    summary += `${sentence.trim()} `;
  }

  return summary.trim() || `${trimmed.slice(0, maxChars).trim()}...`;
}

export function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}
