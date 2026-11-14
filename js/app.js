// Wires the store, engine, sound mixer and the four tabs together.
//
// UI module contract: mount(section, ctx) returns { render(state) }.
// render is called on every store change (any tab) and must be cheap and
// idempotent; the focus view is also rendered on every clock tick.
// state = { settings, session, todos, shop, sound, now }.
import { createStore } from "./store.js";
import { createEngine } from "./engine.js";
import { createMixer } from "./sounds.js";
import { hydrateIcons, toast } from "./ui.js";
import * as focus from "./focus.js";
import * as todo from "./todo.js";
import * as records from "./records.js";
import * as shop from "./shop.js";

const local = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
const params = new URLSearchParams(location.search);
// Dev-only fast clock: one minute lasts one second. Ignored on any other host.
const fast = local && params.has("fast");

// Getting localStorage can itself throw (SecurityError) when the browser
// blocks site data; that must still end in a readable notice, not a blank page.
function openStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem("focuschair.v1");
    return storage;
  } catch {
    return null;
  }
}

hydrateIcons();
const storage = navigator.locks ? openStorage() : null;
const store = storage ? createStore({ storage, locks: navigator.locks, minute: fast ? 1000 : 60_000 }) : null;

if (!store?.canWrite) {
  const blocked = document.getElementById("blocked");
  if (navigator.locks && !storage) {
    blocked.querySelector("h1").textContent = "無法使用瀏覽器的儲存空間";
    blocked.querySelector("p").textContent = "這個 app 需要把資料存在瀏覽器裡。請關閉私密瀏覽，或在設定中允許網站資料後再開啟。";
  }
  blocked.hidden = false;
  blocked.setAttribute("role", "alert");
  document.getElementById("app").hidden = true;
  document.querySelector(".tabbar").hidden = true;
} else {
  start();
}

function phaseOf(state) {
  return state.session.active?.phase ?? "idle";
}

function start() {
  const engine = createEngine({ store, minute: fast ? 1000 : 60_000 });
  const mixer = createMixer({ store });
  const ctx = {
    store,
    engine,
    mixer,
    fast,
    state: () => ({ ...store.readAll(), now: Date.now() }),
    report(error) {
      console.error(error);
      toast("發生錯誤，請再試一次", { error: true });
    },
    showResult: (result) => views.focus.showResult(result),
  };

  const views = {
    focus: focus.mount(document.getElementById("tab-focus"), ctx),
    todo: todo.mount(document.getElementById("tab-todo"), ctx),
    records: records.mount(document.getElementById("tab-records"), ctx),
    shop: shop.mount(document.getElementById("tab-shop"), ctx),
  };
  let currentTab = "focus";

  function render() {
    const state = ctx.state();
    views.focus.render(state);
    if (currentTab !== "focus") views[currentTab].render(state);
    mixer.sync(phaseOf(state));
    syncWakeLock();
  }

  document.querySelectorAll(".tabbar button").forEach((button) => {
    button.addEventListener("click", () => {
      currentTab = button.dataset.tab;
      document.querySelectorAll(".tabbar button").forEach((b) => {
        if (b === button) b.setAttribute("aria-current", "page");
        else b.removeAttribute("aria-current");
      });
      document.querySelectorAll("#app > .tab").forEach((section) => {
        section.hidden = section.id !== `tab-${currentTab}`;
      });
      window.scrollTo(0, 0);
      render();
    });
  });

  store.subscribe(render);
  store.watch(window);

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      await engine.tick(); // completions are presented by the focus view from session.results
    } catch (error) {
      ctx.report(error);
    } finally {
      ticking = false;
    }
    const state = ctx.state();
    views.focus.render(state);
    // Re-syncing on every tick lets a sound that failed to load (e.g. while
    // offline) be retried after its cooldown, without any other change.
    mixer.sync(phaseOf(state));
    syncWakeLock();
  }

  // Screen Wake Lock: keep the screen on while focusing, when enabled.
  // One request at a time; when it resolves, the wish is checked again and
  // an obsolete lock is released at once.
  let wakeLock = null;
  let wakePending = false;
  const wantWakeLock = () => {
    const state = ctx.state();
    return state.settings.keepAwake && phaseOf(state) === "focusing" && !document.hidden;
  };
  async function syncWakeLock() {
    if (!("wakeLock" in navigator)) return;
    if (!wantWakeLock()) {
      if (wakeLock) {
        const sentinel = wakeLock;
        wakeLock = null;
        sentinel.release().catch(() => {});
      }
      return;
    }
    if (wakeLock || wakePending) return;
    wakePending = true;
    try {
      const sentinel = await navigator.wakeLock.request("screen");
      if (wantWakeLock()) {
        wakeLock = sentinel;
        sentinel.addEventListener("release", () => { if (wakeLock === sentinel) wakeLock = null; });
      } else {
        sentinel.release().catch(() => {});
      }
    } catch {
      // Denied or unsupported here; try again on the next sync.
    } finally {
      wakePending = false;
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) tick();
    render();
  });

  setInterval(tick, fast ? 200 : 500);
  tick();
  render();

  // Offline support. Skipped on localhost unless ?sw is given, so local
  // development never serves stale cached files.
  if ("serviceWorker" in navigator && (!local || params.has("sw"))) {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("service worker", error));
  }
}
