import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/pagehook/utils.js", import.meta.url), "utf8");

test("attention cues are bounded, respect reduced motion, and reuse a single cursor cue", () => {
  let now = 1000;
  let reduced = false;
  const animations = [];
  const elements = [];
  const element = () => ({
    isConnected: true,
    style: {},
    setAttribute() {},
    animate(frames, options) {
      const animation = { frames, options, cancelled: false, cancel() { this.cancelled = true; } };
      animations.push(animation);
      return animation;
    },
  });
  const document = {
    visibilityState: "visible",
    createElement: element,
    body: { appendChild: (child) => elements.push(child) },
  };
  const namespace = { state: { lastMouseX: 100, lastMouseY: 200 }, constants: {}, fn: {} };
  vm.runInNewContext(source, {
    Date: { now: () => now },
    document,
    window: { __OFE: namespace, matchMedia: () => ({ matches: reduced }) },
  });
  const { fn } = namespace;
  const target = element();
  assert.equal(fn.flashAttention(target), true);
  assert.equal(fn.flashAttention(target), false);
  assert.equal(animations.length, 1);
  assert.equal(animations[0].options.duration, 900);
  assert.equal(animations[0].frames[1].outlineColor, "transparent");
  now += 1300;
  reduced = true;
  assert.equal(fn.flashAttention(target), true);
  assert.equal(animations[0].cancelled, true);
  assert.deepEqual(animations[1].frames[0], animations[1].frames[1]);
  fn.flashBlockedAction();
  const firstCursorAnimation = animations.at(-1);
  namespace.state.lastMouseX = 300;
  now += 250;
  fn.flashBlockedAction();
  assert.equal(firstCursorAnimation.cancelled, true);
  assert.notEqual(animations.at(-1), firstCursorAnimation);
  assert.equal(elements.length, 1);
  assert.equal(elements[0].style.left, "300px");
  assert.equal(elements[0].style.top, "200px");
  document.visibilityState = "hidden";
  now += 1300;
  assert.equal(fn.flashAttention(target), false);
  target.isConnected = false;
  document.visibilityState = "visible";
  assert.equal(fn.flashAttention(target), false);
});
