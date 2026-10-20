import assert from "node:assert/strict";
import { test } from "node:test";
import { seededShuffle } from "../src/shuffle.ts";

const items = Array.from({ length: 20 }, (_, i) => i);

test("same seed gives the same order; input is not mutated", () => {
  const copy = [...items];
  assert.deepEqual(seededShuffle(items, "device-a"), seededShuffle(items, "device-a"));
  assert.deepEqual(items, copy);
});

test("result is a permutation", () => {
  assert.deepEqual([...seededShuffle(items, "x")].sort((a, b) => a - b), items);
});

test("different seeds spread the first position", () => {
  const firsts = new Set(Array.from({ length: 50 }, (_, i) => seededShuffle(items, `device-${i}`)[0]));
  assert.ok(firsts.size >= 10, `only ${firsts.size} distinct first items`);
});
