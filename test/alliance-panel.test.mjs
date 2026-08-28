import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/alliance-panel.js", import.meta.url),
  "utf8",
);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.listeners = new Map();
    this.style = {};
    this.scrollTop = 0;
    this._textContent = "";
  }

  set textContent(value) {
    this._textContent = String(value);
    if (value === "") this.children = [];
  }

  get textContent() {
    return this._textContent;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  click() {
    this.listeners.get("click")?.({ stopPropagation() {} });
  }
}

function descendants(root) {
  return [root, ...root.children.flatMap(descendants)];
}

function createHarness() {
  let renewCount = 0;
  let nativeUpdateCount = 0;
  const nativeRenewal = {
    allianceID: 7,
    buttons: [
      { className: "btn-gray", action() {} },
      { className: "btn", action: () => renewCount++ },
      { className: "btn-info", action() {} },
    ],
  };
  const nativeOtherEvent = { description: "Keep me" };
  const actionableEvents = {
    events: [nativeRenewal, nativeOtherEvent],
    alliancesCheckedAt: new Map([[7, 1000]]),
    requestUpdate() {
      nativeUpdateCount++;
    },
  };

  const alliance = { id: 7, other: 42, expiresAt: 1100 };
  const other = {
    displayName: () => "Ally",
    isAlive: () => true,
    nameLocation: () => ({ x: 1, y: 2 }),
  };
  const me = {
    alliances: () => [alliance],
    isAlive: () => true,
  };
  const game = {
    config: () => ({ allianceExtensionPromptOffset: () => 300 }),
    inSpawnPhase: () => false,
    myPlayer: () => me,
    player: () => other,
    ticks: () => 1000,
  };

  const body = new FakeElement("body");
  const namespace = {
    state: {
      allianceExtensionPendingById: new Map(),
      alliancePanelState: null,
      gamePhase: "playing",
    },
    fn: {
      getAnyGameView: () => game,
      getPlayerDisplayName: (player) => player.displayName(),
      installOverlayInteractionGuards() {},
      onNativeGameChange() {},
      onNativeGameTick() {},
      resolvePlayerSmallID: (id) => id,
    },
  };
  const storage = new Map();
  const sandbox = {
    clearTimeout,
    console,
    document: {
      body,
      documentElement: body,
      createElement: (tagName) => new FakeElement(tagName),
      querySelector: (selector) =>
        selector === "actionable-events" ? actionableEvents : null,
    },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
    queueMicrotask,
    setTimeout,
    window: {
      __OFE: namespace,
      addEventListener() {},
      setTimeout,
    },
  };

  vm.runInNewContext(source, sandbox);
  namespace.fn.initAlliancePanel();

  return {
    actionableEvents,
    body,
    nativeOtherEvent,
    nativeUpdateCount: () => nativeUpdateCount,
    renewCount: () => renewCount,
  };
}

function findButton(body, text) {
  return descendants(body).find(
    (element) => element.tagName === "BUTTON" && element.textContent === text,
  );
}

test("alliance panel replaces the native renewal card and keeps its renew action", () => {
  const harness = createHarness();

  assert.equal(harness.actionableEvents.events.length, 1);
  assert.equal(harness.actionableEvents.events[0], harness.nativeOtherEvent);
  assert.equal(harness.nativeUpdateCount(), 1);
  assert.ok(findButton(harness.body, "Ignore"));

  findButton(harness.body, "Renew").click();

  assert.equal(harness.renewCount(), 1);
  assert.ok(findButton(harness.body, "Pending"));
  assert.equal(findButton(harness.body, "Ignore"), undefined);
});

test("ignoring a renewal dismisses its controls and warning for that cycle", () => {
  const harness = createHarness();

  findButton(harness.body, "Ignore").click();

  assert.equal(findButton(harness.body, "Renew"), undefined);
  assert.equal(findButton(harness.body, "Ignore"), undefined);
  assert.ok(
    descendants(harness.body).some(
      (element) => element.textContent === "0:10 left · ignored",
    ),
  );
});
