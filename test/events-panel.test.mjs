import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/events-panel.js", import.meta.url),
  "utf8",
);

test("bottom-right events keep alliance requests and omit renewals and incoming bombs", () => {
  let tickListener = null;
  let requestUpdates = 0;
  const elements = new Map();
  const eventsDisplay = {
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
  tickListener();

  assert.equal(eventsDisplay.events.length, 2);
  assert.equal(eventsDisplay.events[0].type, 15);
  assert.equal(eventsDisplay.events[1].type, 20);
  assert.equal(requestUpdates, 1);
});
