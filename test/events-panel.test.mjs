import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/events-panel.js", import.meta.url),
  "utf8",
);

function createHarness() {
  let now = 1000;
  let tickListener = null;
  let requestUpdates = 0;
  const elements = new Map();
  const eventsDisplay = {
    game: { ticks: () => 1000 },
    events: [
      { description: "Alliance request", type: 15 },
      { description: "Alliance renewal request", type: 21 },
      { description: "Atom bomb inbound", type: 5 },
      { description: "Hydrogen bomb inbound", type: 7 },
      { description: "MIRV inbound", type: 4 },
      { description: "Chat message", type: 20 },
    ],
    getBoundingClientRect: () => ({ left: 100, top: 20 }),
    querySelectorAll: () => [],
    requestUpdate: () => requestUpdates++,
  };
  const body = {
    appendChild(element) {
      elements.set(element.id, element);
    },
  };
  const namespace = {
    constants: {
      MESSAGE_TYPE: {
        ALLIANCE_REQUEST: 15,
        RENEW_ALLIANCE: 21,
        MIRV_INBOUND: 4,
        NUKE_INBOUND: 5,
        HYDROGEN_BOMB_INBOUND: 7,
      },
    },
    state: {},
    fn: {
      onNativeGameTick: (listener) => {
        tickListener = listener;
      },
    },
  };
  const sandbox = {
    Date: { now: () => now },
    console,
    customElements: { whenDefined: () => new Promise(() => {}) },
    document: {
      body,
      createElement: () => ({
        addEventListener() {},
        setAttribute() {},
        style: {},
      }),
      getElementById: (id) => elements.get(id) || null,
      querySelector: (selector) =>
        selector === "events-display" ? eventsDisplay : null,
    },
    localStorage: {
      getItem: () => null,
      setItem() {},
    },
    MutationObserver: class {
      disconnect() {}
      observe() {}
    },
    window: {
      __OFE: namespace,
      addEventListener() {},
    },
  };

  vm.runInNewContext(source, sandbox);
  namespace.fn.initEventsPanelIntegration();
  return {
    eventsDisplay,
    namespace,
    elements,
    tick: () => tickListener(),
    advanceTime: (ms) => { now += ms; },
    requestUpdates: () => requestUpdates,
  };
}

test("bottom-right events keep alliance requests and omit renewals and incoming bombs", () => {
  const harness = createHarness();
  const { eventsDisplay } = harness;
  harness.tick();

  assert.equal(eventsDisplay.events.length, 2);
  assert.equal(eventsDisplay.events[0].type, 15);
  assert.equal(eventsDisplay.events[1].type, 20);
  assert.equal(harness.requestUpdates(), 1);
});

test("feed sound cues wait for the matching message and flash once, including when filtered", () => {
  const harness = createHarness();
  const { namespace, eventsDisplay } = harness;
  const flashes = [];
  namespace.fn.flashAttention = (element) => flashes.push(element);
  const event = { description: "\u2063\u2064\u2063Enemy boat inbound", ofeExtensionEvent: true, createdAt: 1000 };
  eventsDisplay.events = [event];
  namespace.fn.flashEventsPanel();
  assert.equal(flashes.length, 0);
  const cell = {};
  const row = {
    textContent: event.description,
    style: {},
    querySelector: () => cell,
  };
  eventsDisplay.querySelectorAll = () => [row];
  harness.tick();
  harness.tick();
  assert.deepEqual(flashes, [cell]);
  namespace.state.eventsPanelState.hidden = true;
  namespace.fn.flashEventsPanel();
  assert.equal(flashes.at(-1), harness.elements.get("ofe-events-filter-toggle"));
  assert.equal(row.style.display, "none");
  eventsDisplay.game.ticks = () => 1001;
  namespace.fn.flashEventsPanel();
  assert.equal(flashes.length, 2);
});

test("feed sound cues expire instead of flashing an old message on a later render", () => {
  const harness = createHarness();
  const { namespace, eventsDisplay } = harness;
  const flashes = [];
  namespace.fn.flashAttention = (element) => flashes.push(element);
  const event = { description: "\u2063\u2064\u2063Boat landed", ofeExtensionEvent: true, createdAt: 1000 };
  eventsDisplay.events = [event];
  namespace.fn.flashEventsPanel();
  harness.advanceTime(1600);
  eventsDisplay.querySelectorAll = () => [{ textContent: event.description, style: {} }];
  harness.tick();
  assert.deepEqual(flashes, []);
});
