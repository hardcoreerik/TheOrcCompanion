import assert from "node:assert/strict";
import test from "node:test";
import { parseDuckDuckGoHtml } from "./webSearch";

test("keeps search title, canonical URL, and snippet together", () => {
  const html = '<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fnews">Example News</a><a class="result__snippet">Current local AI news</a>';
  assert.deepEqual(parseDuckDuckGoHtml(html, 5), [{ title: "Example News", url: "https://example.com/news", snippet: "Current local AI news" }]);
});
