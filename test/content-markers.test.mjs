import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createMarkerHarness } from "./helpers/marker-harness.mjs";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");

function withStacks(stacks, extra = {}) {
  return createMarkerHarness(source, {
    "data-ofe-building-stacks": JSON.stringify(stacks),
    ...extra,
  });
}

function ids(harness) {
  return harness.markers("building-stack").map((marker) => marker.id);
}

test("building overlays stay capped and prioritize the highest levels", () => {
  const stacks = Object.fromEntries(Array.from({ length: 100 }, (_, id) => [id, {
    x: (id % 10) * 80,
    y: Math.floor(id / 10) * 80,
    level: 11 + id,
  }]));
  const harness = withStacks(stacks);
  assert.equal(ids(harness).length, 24);
  assert.deepEqual(ids(harness), Array.from({ length: 24 }, (_, index) => `ofe-building-stack-${99 - index}`));
  assert.equal(harness.markers("building-stack")[0].children[0].textContent, "110");
});

test("nearby overlays collapse to the highest level and separate when zooming in", () => {
  const harness = withStacks({
    1: { x: 100, y: 100, level: 11 },
    2: { x: 120, y: 120, level: 20 },
    3: { x: 184, y: 120, level: 12 },
  });
  assert.deepEqual(ids(harness), ["ofe-building-stack-2", "ofe-building-stack-3"]);
  harness.setAttribute("data-ofe-map-transform", { x: -600, y: -400, scale: 4 });
  assert.equal(ids(harness).length, 3);
});

test("offscreen overlays are removed and restored after panning or resizing", () => {
  const harness = withStacks({
    1: { x: 100, y: 100, level: 12 },
    2: { x: 1400, y: 100, level: 20 },
  });
  assert.deepEqual(ids(harness), ["ofe-building-stack-1"]);
  harness.setAttribute("data-ofe-map-transform", { x: -1900, y: -400, scale: 1 });
  assert.deepEqual(ids(harness), ["ofe-building-stack-2"]);
  harness.setAttribute("data-ofe-map-transform", { x: -600, y: -400, scale: 1 });
  assert.deepEqual(ids(harness), ["ofe-building-stack-1"]);
  harness.resize(1800, 800);
  assert.equal(ids(harness).length, 2);
});

test("marker data is reused during panning and refreshed when levels or buildings change", () => {
  const harness = withStacks({ 1: { x: 100, y: 100, level: 12 } });
  const marker = harness.markers("building-stack")[0];
  const before = harness.metrics.parses;
  harness.setAttribute("data-ofe-map-transform", { x: -610, y: -400, scale: 1 });
  harness.poll();
  assert.equal(harness.metrics.parses - before, 1);
  assert.equal(harness.markers("building-stack")[0], marker);
  harness.setAttribute("data-ofe-building-stacks", { 1: { x: 100, y: 100, level: 30 } });
  assert.equal(marker.children[0].textContent, "30");
  harness.setAttribute("data-ofe-building-stacks", {});
  assert.equal(ids(harness).length, 0);
});

test("building limits leave transport and temporary markers intact and game end clears all markers", () => {
  const harness = withStacks({ 1: { x: 100, y: 100, level: 12 } }, {
    "data-ofe-transport-ships": JSON.stringify({ 9: { x: 100, y: 100 } }),
    "data-ofe-boat-landings": JSON.stringify([{ id: 10, x: 100, y: 100, expiresAt: 2000 }]),
    "data-ofe-mini-territories": JSON.stringify([{ id: 11, x: 100, y: 100, size: 3, expiresAt: 2000 }]),
  });
  assert.equal(harness.markers("transport").length, 1);
  assert.equal(harness.markers("boat-landing").length, 1);
  assert.equal(harness.markers("mini-territory").length, 1);
  harness.expire(2100);
  assert.equal(harness.markers("boat-landing").length, 0);
  assert.equal(harness.markers("mini-territory").length, 0);
  assert.equal(ids(harness).length, 1);
  harness.setAttribute("data-ofe-game-phase", "none");
  assert.equal(ids(harness).length, 0);
  assert.equal(harness.markers("transport").length, 0);
  harness.setAttribute("data-ofe-game-phase", "playing");
  assert.equal(ids(harness).length, 1);
});
