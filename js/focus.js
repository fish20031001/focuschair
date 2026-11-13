// The 專注 tab: header, room, clock, controls, the result sheet and settings.
import { CHARACTER, MODES, itemById, RARITY_LABEL, STOPWATCH_MAX_MINUTES, STOPWATCH_MIN_MINUTES } from "./catalog.js";
import * as economy from "./economy.js";
import * as stats from "./stats.js";
import { createRoom } from "./room.js";
import { clockText, coinLabel, confirmDialog, h, icon, itemImage, openSheet, toast } from "./ui.js";

function moodFor(state, lastDrop) {
  const phase = state.session.active?.phase;
  if (phase === "focusing") return "focus";
  if (phase === "breaking") return "sleep";
  if (lastDrop?.kind === "gift") return "happy";
  if (lastDrop?.kind === "trash") return "sad";
  return "idle";
}

function statusText(phase) {
  if (phase === "focusing") return `${CHARACTER.name}陪你專注中…`;
  if (phase === "breaking") return `休息一下，${CHARACTER.name}在打盹`;
  return `${CHARACTER.name}在等你開始`;
}

export function mount(section, ctx) {
  const { store, engine, mixer } = ctx;
  const run = (promise) => Promise.resolve(promise).catch(ctx.report);

  const today = h("span", { class: "today" });
  const balance = h("span");
  const soundButton = h("button", {
    class: "icon-btn", type: "button", attrs: { "aria-label": "白噪音" },
    onclick: () => { run(mixer.unlock()); mixer.openSheet(); },
  }, icon("speaker"));
  const settingsButton = h("button", {
    class: "icon-btn", type: "button", attrs: { "aria-label": "設定" }, onclick: () => openSettings(),
  }, icon("gear"));
  const roomBox = h("div", { class: "focus-room" });
  const clock = h("div", { class: "clock", attrs: { role: "timer", "aria-live": "off" } });
  const status = h("div", { class: "status" });
  const bar = h("div");
  const progress = h("div", { class: "progress", attrs: { role: "progressbar", "aria-label": "進度" } }, bar);
  const resumeAudio = h("button", {
    class: "btn small resume-audio", type: "button",
    onclick: () => run(mixer.unlock()),
  }, icon("play"), h("span", { text: "播放白噪音" }));
  const resumeAudioLabel = resumeAudio.lastChild;
  const controls = h("div", { class: "controls" });

  section.append(
    h("div", { class: "focus-head" }, today, balance, soundButton, settingsButton),
    roomBox, clock, status, progress, h("div", { class: "controls" }, resumeAudio), controls,
  );
  const room = createRoom(roomBox);

  // Completion results are presented from session.results, the completion
  // events written in the same transaction that records each session. Every
  // tab shows each new event once, in order, while it is visible; events seen
  // while hidden wait in the queue. Events present at startup count as seen,
  // so a reload never replays them (and an import clears them).
  // "Seen" is kept per import generation. Data from an import that is later
  // rolled back can be glimpsed by another tab mid-write; returning to the
  // earlier generation then restores its seen-set, so nothing is replayed.
  const startup = store.read("session");
  let importGen = startup.importGen ?? null;
  const seenByGen = new Map([[importGen, new Set(startup.results.map((event) => event.id))]]);
  let seen = seenByGen.get(importGen);
  let queue = [];
  let presenting = false;
  let openResultSheet = null;
  let openResultId = null;

  function collectResults(session) {
    const gen = session.importGen ?? null;
    if (gen !== importGen) {
      importGen = gen;
      // A generation not met before is a fresh import: everything in it
      // happened after the import, so all its events are new.
      if (!seenByGen.has(gen)) seenByGen.set(gen, new Set());
      seen = seenByGen.get(gen);
      // Keep only queued results that still exist in this data.
      const ids = new Set(session.records.map((r) => r.id));
      queue = queue.filter((id) => ids.has(id));
      // A result sheet whose record this data no longer has is stale: close
      // it (with the queue already filtered, closing presents nothing stale).
      if (openResultSheet && !ids.has(openResultId)) {
        const stale = openResultSheet;
        openResultSheet = null;
        stale.close();
      }
    }
    for (const event of session.results) {
      if (!seen.has(event.id)) {
        seen.add(event.id);
        queue.push(event.id);
      }
    }
    presentNext();
  }

  function presentNext() {
    if (presenting || document.hidden || queue.length === 0) return;
    const session = store.read("session");
    const id = queue.shift();
    const record = session.records.find((r) => r.id === id);
    const item = record && itemById(record.itemID);
    if (!item) {
      presentNext();
      return;
    }
    presenting = true;
    openResultId = id;
    if (record.success) mixer.chime();
    showResult(
      { success: record.success, item, minutes: record.minutes, mode: record.mode, reward: economy.rewardForRecord(record) },
      () => {
        presenting = false;
        presentNext();
      },
    );
  }

  // ---- controls (rebuilt only when what they show changes) ----
  let controlsKey = "";

  /** Steps a minutes setting from its stored value, so rapid taps all count. */
  function stepper(label, key, value, min, max, step) {
    const output = h("output", { text: `${value} 分鐘` });
    const change = (delta) => run(store.update("settings", (s) => ({
      ...s, [key]: Math.min(max, Math.max(min, s[key] + delta)),
    })));
    return h("div", { class: "stepper" },
      h("span", { class: "label", text: label }),
      h("button", { class: "btn small", type: "button", disabled: value <= min, attrs: { "aria-label": `${label}減少` }, onclick: () => change(-step) }, "−"),
      output,
      h("button", { class: "btn small", type: "button", disabled: value >= max, attrs: { "aria-label": `${label}增加` }, onclick: () => change(step) }, "+"),
    );
  }

  function setSettings(patch) {
    run(store.update("settings", (s) => ({ ...s, ...patch })));
  }

  function idleControls(state) {
    const { settings } = state;
    const open = state.todos.filter((t) => !t.done);
    const linked = open.some((t) => t.id === settings.linkedTodoID) ? settings.linkedTodoID : "";
    const modeButtons = Object.entries(MODES).map(([mode, { title }]) =>
      h("button", {
        type: "button", text: title, attrs: { "aria-pressed": String(settings.mode === mode) },
        onclick: () => setSettings({ mode }),
      }));
    const select = h("select", {
      attrs: { "aria-label": "專注項目" },
      onchange: (e) => setSettings({ linkedTodoID: e.target.value || null }),
    },
    h("option", { value: "", text: "不指定" }),
    open.map((t) => h("option", { value: t.id, text: t.title })));
    select.value = linked;

    return [
      h("div", { class: "segmented", attrs: { role: "group", "aria-label": "模式" } }, modeButtons),
      settings.mode === "pomodoro"
        ? [
          stepper("專注", "focusMinutes", settings.focusMinutes, 5, 120, 5),
          stepper("休息", "breakMinutes", settings.breakMinutes, 1, 30, 1),
        ]
        : h("p", { class: "muted small-text", text: `至少 ${STOPWATCH_MIN_MINUTES} 分鐘才算完成，最多 ${STOPWATCH_MAX_MINUTES} 分鐘` }),
      h("label", { class: "row select-row" }, h("span", { class: "grow", text: "專注項目" }), select),
      h("button", {
        class: "btn primary block", type: "button", text: "開始專注",
        onclick: () => {
          run(mixer.unlock()); // a user gesture: allow sound for this session
          run(engine.startFocus());
        },
      }),
    ];
  }

  // Both confirmations act on the session that was showing when they were
  // opened; if another tab ended it meanwhile, confirming does nothing.
  // Both act on the session the button was rendered for (id), never on
  // whatever session happens to be stored when it is tapped.
  async function giveUp(id) {
    const ok = await confirmDialog({
      title: `現在放棄，${CHARACTER.name}會留下垃圾喔`, confirmLabel: "放棄", cancelLabel: "繼續專注", destructive: true,
    });
    if (ok && id) await engine.giveUp(id); // the result sheet follows from session.results
  }

  async function finishStopwatch(id) {
    if (!id) return;
    if (!engine.canFinishStopwatch()) {
      const ok = await confirmDialog({
        title: `未滿 ${STOPWATCH_MIN_MINUTES} 分鐘，現在結束會視為放棄`, confirmLabel: "結束", cancelLabel: "繼續專注", destructive: true,
      });
      if (!ok) return;
    }
    await engine.finishStopwatch(id);
  }

  function activeControls(active) {
    if (active.phase === "breaking") {
      return h("button", { class: "btn block", type: "button", text: "跳過休息", onclick: () => run(engine.skipBreak(active.id)) });
    }
    const giveUpButton = h("button", { class: "btn block", type: "button", text: "放棄", onclick: () => run(giveUp(active.id)) });
    if (active.mode === "stopwatch") {
      return h("div", { class: "pair" },
        giveUpButton,
        h("button", { class: "btn primary block", type: "button", text: "完成", onclick: () => run(finishStopwatch(active.id)) }));
    }
    return giveUpButton;
  }

  function renderControls(state) {
    const active = state.session.active;
    const open = state.todos.filter((t) => !t.done).map((t) => `${t.id}:${t.title}`).join("|");
    const key = active
      ? `${active.id}:${active.phase}:${active.mode}`
      : JSON.stringify([state.settings.mode, state.settings.focusMinutes, state.settings.breakMinutes, state.settings.linkedTodoID, open]);
    if (key === controlsKey) return;
    controlsKey = key;
    controls.replaceChildren(...[active ? activeControls(active) : idleControls(state)].flat(2));
  }

  // ---- result sheet ----
  function showResult(result, onClose) {
    if (!result) return;
    const { item, success, minutes, mode } = result;
    let sheet;
    const actions = [];
    let stopFollowing = () => {};
    if (success && mode === "pomodoro") {
      const breakLabel = () => `休息 ${store.read("settings").breakMinutes} 分鐘`;
      const breakButton = h("button", {
        class: "btn primary block", type: "button", text: breakLabel(),
        onclick: () => { sheet.close(); run(engine.startBreak()); },
      });
      // The label always shows the length startBreak() will use.
      stopFollowing = store.subscribe(() => { breakButton.textContent = breakLabel(); });
      actions.push(breakButton);
    }
    actions.push(h("button", { class: "btn block", type: "button", text: success ? "收下" : "好", onclick: () => sheet.close() }));
    const art = itemImage(item);
    art.classList.add("art");
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) art.classList.add("pop-in");
    sheet = openSheet({
      onClose: () => {
        stopFollowing();
        if (openResultSheet === sheet) openResultSheet = null;
        onClose?.();
      },
      title: success ? "專注完成" : "放棄了",
      content: h("div", { class: "result" },
        art,
        h("h2", { text: success ? `${CHARACTER.name}送你一份禮物！` : `${CHARACTER.name}留下了垃圾…` }),
        h("p", {
          class: "muted",
          text: success ? `${item.name}（${RARITY_LABEL[item.rarity]}）・專注 ${minutes} 分鐘` : `${item.name}・下次再一起加油`,
        }),
        result.reward > 0 ? coinLabel(result.reward, "+") : null,
        h("div", { class: "actions" }, actions)),
    });
    openResultSheet = sheet;
  }

  // ---- settings sheet ----
  function openSettings() {
    const settings = store.read("settings");
    const keepAwake = h("input", {
      type: "checkbox", checked: settings.keepAwake,
      onchange: (e) => setSettings({ keepAwake: e.target.checked }),
    });
    const fileInput = h("input", {
      type: "file", accept: "application/json,.json", hidden: true,
      onchange: async (e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) return;
        const ok = await confirmDialog({ title: "匯入備份？", message: "目前的資料會被備份檔的內容取代。", confirmLabel: "匯入", destructive: true });
        if (!ok) return;
        try {
          await store.importAll(await file.text());
          toast("已匯入備份");
        } catch (error) {
          toast(`匯入失敗：${error.message}`, { error: true });
        }
      },
    });
    async function exportData() {
      let text;
      try {
        text = await store.exportAll();
      } catch (error) {
        toast(`匯出失敗：${error.message}`, { error: true });
        return;
      }
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const now = new Date(); // local date, not UTC
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const link = h("a", { href: url, download: `focuschair-backup-${date}.json` });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    // Keep the checkbox in step with imports and other tabs while open.
    const unsubscribe = store.subscribe(() => {
      keepAwake.checked = store.read("settings").keepAwake;
    });
    openSheet({
      onClose: unsubscribe,
      title: "設定",
      content: h("div", {},
        h("div", { class: "group" }, h("div", { class: "group-body" },
          h("label", { class: "row" }, h("span", { class: "grow", text: "專注時保持螢幕常亮" }), keepAwake))),
        h("div", { class: "group" },
          h("h2", { text: "資料備份" }),
          h("div", { class: "group-body" },
            h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "匯出備份", onclick: exportData })),
            h("div", { class: "row" }, h("button", { class: "btn small", type: "button", text: "匯入備份", onclick: () => fileInput.click() })),
          ),
          h("p", { class: "muted small-text", text: "資料只存在這支手機的瀏覽器裡。建議把 app 加到主畫面，並偶爾匯出備份。" })),
        fileInput),
    });
  }

  // ---- render ----
  return {
    showResult,
    render(state) {
      const active = state.session.active;
      const phase = active?.phase ?? "idle";
      const lastDrop = engine.lastDrop();
      collectResults(state.session);
      today.textContent = `今日專注 ${stats.minutesOn(state.session.records, state.now)} 分鐘`;
      balance.replaceChildren(coinLabel(economy.balance(state.session.records, state.shop)));
      room.update({ mood: moodFor(state, lastDrop), onChair: phase === "focusing", drop: lastDrop, decor: economy.roomDecor(state.shop) });
      const text = clockText(engine.displaySeconds());
      if (clock.textContent !== text) clock.textContent = text;
      status.textContent = statusText(phase);
      const showProgress = active && !(phase === "focusing" && active.mode === "stopwatch");
      progress.hidden = !showProgress;
      if (showProgress) bar.style.width = `${(engine.progress() * 100).toFixed(1)}%`;
      const tap = mixer.needsTap(phase);
      resumeAudio.hidden = !tap;
      if (tap) resumeAudioLabel.textContent = tap === "loops" ? "播放白噪音" : "開啟提示音";
      renderControls(state);
    },
  };
}

