import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../src/pagehook/alliance-panel.js", import.meta.url),
  "utf8",
);
const neighborSource = await readFile(
  new URL("../src/pagehook/neighbor-watch.js", import.meta.url),
  "utf8",
);
const contentStyles = await readFile(
  new URL("../src/content.css", import.meta.url),
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

function createHarness({ sidebarRect = null } = {}) {
  let now = Date.now();
  const tickListeners = [];
  const gameChangeListeners = [];
  const activityEvents = [];
  const sounds = [];
  let renewCount = 0;
  let nativeUpdateCount = 0;
  const focusTargets = [];
  const nativeRenewal = {
    allianceID: 7,
    buttons: [
      { className: "btn-gray", action() {} },
      { className: "btn", action: () => renewCount++ },
      { className: "btn-info", action() {} },
    ],
  };
  const nativeRequest = {
    type: 15,
    requestorID: 43,
    focusID: 43,
    createdAt: 1000,
    duration: 300,
    buttons: [
      { className: "btn-gray", action() {} },
      { className: "btn", action() {} },
      { className: "btn-info", action() {} },
    ],
  };
  const nativeOtherEvent = { description: "Keep me" };
  const actionableEvents = {
    events: [nativeRenewal, nativeRequest, nativeOtherEvent],
    alliancesCheckedAt: new Map([[7, 1000]]),
    requestUpdate() {
      nativeUpdateCount++;
    },
  };

  const alliance = { id: 7, other: 42, expiresAt: 1100 };
  const other = {
    displayName: () => "Ally",
    smallID: () => 42,
    isPlayer: () => true,
    isTraitor: () => false,
    isAlive: () => true,
    nameLocation: () => ({ x: 1, y: 2 }),
  };
  const me = {
    alliances: () => [alliance],
    smallID: () => 1,
    borderTiles: async () => ({ borderTiles: [10] }),
    isAlive: () => true,
  };
  const game = {
    neighbors: () => [11],
    hasOwner: () => true,
    ownerID: () => 42,
    playerBySmallID: () => other,
    config: () => ({ allianceExtensionPromptOffset: () => 300 }),
    inSpawnPhase: () => false,
    myPlayer: () => me,
    player: () => other,
    ticks: () => 1000,
  };

  const body = new FakeElement("body");
  const sidebar = sidebarRect
    ? {
        getBoundingClientRect: () => sidebarRect,
      }
    : null;
  const namespace = {
    constants: { MESSAGE_TYPE: { CHAT: 1 } },
    state: {
      allianceExtensionPendingById: new Map(),
      alliancePanelState: null,
      gamePhase: "playing",
      incomingBombs: [],
      neighborStatusById: {},
    },
    fn: {
      focusOfeTarget: (target) => focusTargets.push(target),
      getAnyGameView: () => game,
      getPlayerDisplayName: (player) => player.displayName(),
      installOverlayInteractionGuards() {},
      onNativeGameChange: (listener) => gameChangeListeners.push(listener),
      onNativeGameTick: (listener) => tickListeners.push(listener),
      pushBottomRightEvent: (event) => activityEvents.push(event),
      playExtensionSound: (sound) => sounds.push(sound),
      resolvePlayerSmallID: (id) => id,
    },
  };
  const storage = new Map();
  const sandbox = {
    Date: class extends Date {
      static now() { return now; }
    },
    clearTimeout,
    console,
    document: {
      body,
      documentElement: body,
      createElement: (tagName) => new FakeElement(tagName),
      querySelector: (selector) => {
        if (selector === "actionable-events") return actionableEvents;
        if (selector === "game-right-sidebar") return sidebar;
        return null;
      },
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
      innerWidth: 1024,
      setTimeout,
    },
  };

  vm.runInNewContext(source, sandbox);
  namespace.fn.initAlliancePanel();
  vm.runInNewContext(neighborSource, sandbox);
  namespace.fn.initNeighborWatch();

  return {
    async tick(tick) {
      for (const listener of tickListeners) listener({ tick });
      await new Promise((resolve) => setImmediate(resolve));
    },
    changeGame: () => gameChangeListeners.forEach((listener) => listener()),
    advanceTime: (ms) => { now += ms; },
    other,
    me,
    activityEvents,
    sounds,
    actionableEvents,
    body,
    focusTargets,
    nativeOtherEvent,
    nativeUpdateCount: () => nativeUpdateCount,
    namespace,
    nativeRequest,
    renewCount: () => renewCount,
  };
}

function findById(body, id) {
  return descendants(body).find((element) => element.id === id);
}

function findButton(body, text) {
  return descendants(body).find(
    (element) => element.tagName === "BUTTON" && element.textContent === text,
  );
}

test("alliance panel replaces the native renewal card and keeps its renew action", () => {
  const harness = createHarness();

  assert.equal(harness.actionableEvents.events.length, 2);
  assert.ok(harness.actionableEvents.events.includes(harness.nativeRequest));
  assert.ok(harness.actionableEvents.events.includes(harness.nativeOtherEvent));
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

test("alliance panel keeps native alliance requests in activity", () => {
  const harness = createHarness();

  assert.ok(harness.actionableEvents.events.includes(harness.nativeRequest));
  assert.equal(findButton(harness.body, "Accept"), undefined);
  assert.equal(findButton(harness.body, "Reject"), undefined);
});

test("bomb list styles each threat and keeps a three-row viewport", () => {
  const harness = createHarness();
  const now = Date.now();

  harness.namespace.fn.noteIncomingBombs([{
    kind: "atom",
    unitID: 1,
    senderID: 90,
    senderName: "Old",
    createdAt: now - 31000,
  }]);
  harness.namespace.fn.noteIncomingBombs([
    { kind: "atom", unitID: 2, senderID: 20, senderName: "Bomber 0", createdAt: now },
    { kind: "hydrogen", unitID: 3, senderID: 21, senderName: "Bomber 1", createdAt: now + 1 },
    { kind: "mirv", unitID: 4, senderID: 22, senderName: "Bomber 2", createdAt: now + 2 },
    { kind: "atom", unitID: 5, senderID: 23, senderName: "Bomber 3", createdAt: now + 3 },
  ]);

  const list = findById(harness.body, "ofe-bomb-list");
  assert.equal(list.children.length, 4);
  assert.equal(list.style.maxHeight, "112px");
  assert.equal(list.children[0].children[0].textContent, "Atom bomb");
  assert.equal(list.children[0].children[1].textContent, "from Bomber 3");
  assert.match(list.children[0].style.cssText, /height:34px/);
  assert.match(list.children[0].children[0].style.cssText, /background:rgba\(153,27,27,0\.82\)/);
  assert.equal(list.children[0]["data-ofe-new-bomb"], "true");
  assert.equal(list.children[1].children[0].textContent, "MIRV");
  assert.equal(list.children[1].children[1].textContent, "from Bomber 2");
  assert.match(list.children[1].style.cssText, /height:40px/);
  assert.match(list.children[1].children[0].style.cssText, /background:rgba\(220,38,38,0\.9\)/);
  assert.equal(list.children[2].children[0].textContent, "Hydrogen bomb");
  assert.equal(list.children[2].children[1].textContent, "from Bomber 1");
  assert.match(list.children[2].style.cssText, /height:38px/);
  assert.match(list.children[2].children[0].style.cssText, /background:rgba\(194,65,12,0\.88\)/);
  assert.equal(
    descendants(list).some((element) => element.textContent.includes("Old")),
    false,
  );

  const newestRow = list.children[0];
  newestRow.click();
  assert.equal(harness.focusTargets[0].focusID, 23);

  harness.namespace.fn.noteIncomingBombs([
    { kind: "atom", unitID: 5, senderID: 23, senderName: "Bomber 3", createdAt: now + 3 },
  ]);
  assert.equal(findById(harness.body, "ofe-bomb-list").children[0], newestRow);
});

test("new bomb rows use a short urgency animation with reduced-motion support", () => {
  assert.match(contentStyles, /ofe-bomb-arrival 720ms/);
  assert.match(contentStyles, /ofe-bomb-urgency 420ms/);
  assert.match(contentStyles, /prefers-reduced-motion: reduce/);
});

test("alliance panel and its toggle stay in the top-right", () => {
  const harness = createHarness();
  const panel = findById(harness.body, "ofe-alliance-panel");
  const toggle = findById(harness.body, "ofe-alliance-panel-toggle");

  assert.match(panel.style.cssText, /right:12px;top:84px/);
  assert.match(toggle.style.cssText, /right:12px;top:84px/);
  assert.doesNotMatch(panel.style.cssText, /left:|bottom:/);
  assert.doesNotMatch(toggle.style.cssText, /left:|bottom:/);
});

test("alliance panel moves below a taller game sidebar", () => {
  const harness = createHarness({
    sidebarRect: {
      bottom: 156.2,
      height: 140,
      left: 620,
      right: 1012,
      width: 392,
    },
  });
  const panel = findById(harness.body, "ofe-alliance-panel");
  const toggle = findById(harness.body, "ofe-alliance-panel-toggle");

  assert.equal(panel.style.top, "165px");
  assert.equal(toggle.style.top, "165px");
});


test("neighbor betrayals stay above alliances for a minute and focus the player", async () => {
  const harness = createHarness();
  await harness.tick(10);
  harness.other.isTraitor = () => true;
  harness.other.displayName = () => "<Traitor & Co>";
  harness.me.alliances = () => [];
  await harness.tick(20);

  const list = findById(harness.body, "ofe-betrayal-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[1].children[0].textContent, "<Traitor & Co>");
  assert.equal(list.children[0].children[1].children[1].textContent, "Broke an alliance");
  list.children[0].click();
  assert.equal(harness.focusTargets[0].focusID, 42);
  assert.equal(harness.activityEvents.length, 0);
  assert.deepEqual(harness.sounds, ["neighborTraitor"]);
  const row = list.children[0];
  await harness.tick(30);
  assert.equal(list.children[0], row);
  harness.namespace.fn.noteIncomingBombs([
    { kind: "atom", unitID: 42, senderID: 90, senderName: "Bomber", createdAt: Date.now() },
  ]);
  assert.equal(list.children.length, 1);
  assert.equal(findById(harness.body, "ofe-bomb-list").children.length, 1);
  harness.advanceTime(31000);
  await harness.tick(40);
  assert.equal(list.children.length, 1);
  assert.equal(findById(harness.body, "ofe-bomb-list").children.length, 0);
  harness.advanceTime(30001);
  await harness.tick(50);
  assert.equal(list.children.length, 0);
  assert.equal(list.style.display, "none");
});

test("native betrayal details survive neighbor detection and are visible on the hidden toggle", async () => {
  const h = createHarness();
  await h.tick(10);
  findButton(h.body, "Hide").click();
  h.namespace.fn.notePlayerBetrayal(h.other, { betrayedYou: true, tick: 20 });
  h.other.isTraitor = () => true;
  await h.tick(20);
  const toggle = findById(h.body, "ofe-alliance-panel-toggle");
  assert.equal(toggle.textContent, "Alliances · 1 alert");
  toggle.click();
  const list = findById(h.body, "ofe-betrayal-list");
  assert.equal(list.children.length, 1);
  assert.equal(list.children[0].children[1].children[1].textContent, "Betrayed you");
  assert.equal(list.children[0]["data-personal"], "true");
  assert.deepEqual(h.sounds, []);
  h.changeGame();
  assert.equal(list.children.length, 0);
});
