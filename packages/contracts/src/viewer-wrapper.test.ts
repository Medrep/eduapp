import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeExactUtf8, matchesWrapperResponse, passiveWrapperHtml, wrapperHeaders } from "./viewer-wrapper.ts";

test("UTF-8 decoding preserves the byte-order mark and exact authored bytes", () => {
  const bytes = new TextEncoder().encode("\ufeffZażółć gęślą");
  const decoded = decodeExactUtf8(bytes.buffer);
  assert.equal(decoded, "\ufeffZażółć gęślą");
  assert.deepEqual(new TextEncoder().encode(decoded), bytes);
  assert.throws(() => decodeExactUtf8(new Uint8Array([0xc3, 0x00]).buffer));
});

test("the wrapper response requires the exact URL, all headers and static bytes", async () => {
  const path = "/__viewer/child.html";
  const url = "https://app.example.test" + path;
  const html = passiveWrapperHtml("child");
  const wrapper = { path, html };
  function response(body: string, headers: HeadersInit, responseUrl = url) {
    const value = new Response(body, { headers });
    // A network Response supplies the URL. This unit fixture sets the same field.
    Object.defineProperty(value, "url", { value: responseUrl });
    return value;
  }
  assert.equal(await matchesWrapperResponse(response(html, wrapperHeaders), url, wrapper), true);
  assert.equal(await matchesWrapperResponse(response(passiveWrapperHtml("admin"), wrapperHeaders), url, wrapper), false);
  assert.equal(await matchesWrapperResponse(response(html, {}), url, wrapper), false);
  assert.equal(await matchesWrapperResponse(response(html, wrapperHeaders, url + "?stale"), url, wrapper), false);
  assert.doesNotMatch(html, /<script\b|<iframe\b/i);
});
