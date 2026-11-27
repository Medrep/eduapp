import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedLessonByteLength } from "./index.ts";

test("supports whole byte lengths between one byte and 20 MiB inclusive", () => {
  assert.equal(isSupportedLessonByteLength(1), true);
  assert.equal(isSupportedLessonByteLength(20_971_520), true);
});

test("rejects empty, oversized and invalid byte lengths", () => {
  for (const invalidLength of [0, -1, 20_971_521, 1.5, Infinity, NaN]) {
    assert.equal(isSupportedLessonByteLength(invalidLength), false);
  }
});
