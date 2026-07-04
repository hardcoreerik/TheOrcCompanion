import assert from "node:assert/strict";
import test from "node:test";
import { parseToolCalls, stripToolCalls } from "./parseToolCalls";

test("parses and removes a structured tool request", () => {
  const text = '```json\n{"tool":"web_search","args":{"query":"local AI"}}\n```';
  assert.deepEqual(parseToolCalls(text), [{ tool: "web_search", args: { query: "local AI" } }]);
  assert.equal(stripToolCalls(text), "");
});

test("ignores ordinary JSON", () => {
  assert.deepEqual(parseToolCalls('{"answer":42}'), []);
});
