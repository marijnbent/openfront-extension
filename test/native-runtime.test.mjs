import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/native-runtime.js", import.meta.url),
  "utf8",
);

test("native runtime publishes live ticks, skips catch-up, and detects a new game", async () => {
  class EventsDisplay {
    tick() {
      this.nativeTicks = (this.nativeTicks || 0) + 1;
    }
  }

  const components = new Map();
  const namespace = { state: {}, fn: {} };
  const sandbox = {
    console,
    window: { __OFE: namespace },
    document: {
      querySelector: (selector) => components.get(selector) || null,
    },
    customElements: {
      get: (name) => (name === "events-display" ? EventsDisplay : undefined),
      whenDefined: async () => {},
    },
  };

  vm.runInNewContext(source, sandbox);

  const ticks = [];
  const games = [];
  namespace.fn.onNativeGameTick((event) => ticks.push(event.tick));
  namespace.fn.onNativeGameChange((event) => games.push(event.game));
  namespace.fn.initNativeRuntime();
  await Promise.resolve();

  let tick = 1;
  let catchingUp = false;
  const firstGame = {
    ticks: () => tick,
    isCatchingUp: () => catchingUp,
    updatesSinceLastTick: () => ({ 1: [] }),
  };
  const display = new EventsDisplay();
  display.game = firstGame;
  components.set("events-display", display);

  display.tick();
  display.tick();
  tick = 2;
  display.tick();
  catchingUp = true;
  tick = 3;
  display.tick();
  catchingUp = false;
  tick = 4;
  display.tick();

  const secondGame = {
    ticks: () => 1,
    updatesSinceLastTick: () => ({ 1: [] }),
  };
  display.game = secondGame;
  display.tick();

  assert.deepEqual(ticks, [1, 2, 4, 1]);
  assert.deepEqual(games, [firstGame, secondGame]);
  assert.equal(display.nativeTicks, 6);
});
