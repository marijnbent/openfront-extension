import vm from "node:vm";

export function createMarkerHarness(source, initial = {}) {
  const attributes = new Map(Object.entries({
    "data-ofe-game-phase": "playing",
    "data-ofe-map-transform": JSON.stringify({ x: -600, y: -400, scale: 1 }),
    ...initial,
  }));
  const metrics = { created: 0, parses: 0, labelQueries: 0 };
  const observers = [];
  const intervals = [];
  const timers = new Map();
  const windowListeners = new Map();
  let timerId = 0;
  let now = 1000;

  function element(tag) {
    metrics.created++;
    const properties = new Map();
    return {
      tag,
      style: {
        getPropertyValue: (name) => properties.get(name),
        setProperty: (name, value) => properties.set(name, value),
      },
      dataset: {},
      children: [],
      textContent: "",
      appendChild(child) { child.parent = this; this.children.push(child); },
      contains(child) {
        for (let node = child; node; node = node.parent) {
          if (node === this) return true;
        }
        return false;
      },
      remove() {
        if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
        this.parent = null;
      },
      querySelector(selector) {
        metrics.labelQueries++;
        return this.children.find((child) => child.tag === selector) ?? null;
      },
    };
  }

  const body = element("body");
  const document = {
    readyState: "complete",
    body,
    documentElement: { getAttribute: (name) => attributes.get(name) ?? null },
    createElement: element,
    contains: (node) => body.contains(node),
    querySelector: (selector) => selector === "canvas" ? {} : null,
    querySelectorAll: () => [],
  };
  const window = {
    innerWidth: 1200,
    innerHeight: 800,
    addEventListener: (type, callback) => windowListeners.set(type, callback),
  };
  vm.runInNewContext(source, {
    document,
    window,
    JSON: { parse: (raw) => { metrics.parses++; return JSON.parse(raw); } },
    Date: { now: () => now },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target) { observers.push({ target, callback: this.callback }); }
      disconnect() {}
    },
    setInterval: (callback) => { intervals.push(callback); return intervals.length; },
    setTimeout: (callback) => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: (id) => timers.delete(id),
  });

  return {
    metrics,
    window,
    setAttribute(name, value) {
      if (value === null) attributes.delete(name);
      else attributes.set(name, typeof value === "string" ? value : JSON.stringify(value));
      for (const observer of observers) {
        if (observer.target === document.documentElement) {
          observer.callback([{ type: "attributes", attributeName: name }]);
        }
      }
    },
    markers(kind) {
      return body.children.flatMap((child) => child.children)
        .filter((child) => child.dataset.ofeMarkerKind === kind);
    },
    poll() { for (const callback of intervals) callback(); },
    resize(width, height) {
      window.innerWidth = width;
      window.innerHeight = height;
      windowListeners.get("resize")?.();
    },
    expire(time) {
      now = time;
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
  };
}
