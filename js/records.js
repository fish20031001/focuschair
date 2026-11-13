// 紀錄 tab, ported from RecordsView.swift (統計) and CollectionView.swift (收藏).
// Read-only: it never writes to the store.
import { h, itemImage } from "./ui.js";
import { GIFTS, TRASH, MODES, itemById } from "./catalog.js";
import { minutesOn, minutesThisWeek, streak, successRate, lastDays, sameDay, startOfDay } from "./stats.js";

const WEEKDAYS = "日一二三四五六";
const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text != null) el.textContent = text;
  return el;
}

const pad = (n) => String(n).padStart(2, "0");
function timeText(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rateText(rate) {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

/** The 7-day bar chart as inline SVG. */
function barChart(days) {
  const W = 320;
  const H = 180;
  const top = 22;
  const bottom = 26;
  const plotH = H - top - bottom;
  const slot = W / days.length;
  const barW = Math.min(28, slot * 0.56);
  const max = Math.max(1, ...days.map((d) => d.minutes));
  const summary = days.map((d) => `${WEEKDAYS[d.day.getDay()]} ${d.minutes} 分鐘`).join("，");

  const root = svg("svg", {
    class: "rec-chart",
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `最近 7 天專注分鐘：${summary}`,
    preserveAspectRatio: "xMidYMid meet",
  });
  root.append(svg("line", { x1: 0, x2: W, y1: top + plotH + 0.5, y2: top + plotH + 0.5, class: "rec-chart-axis" }));
  days.forEach((d, i) => {
    const cx = slot * i + slot / 2;
    const barH = d.minutes > 0 ? Math.max(2, (d.minutes / max) * plotH) : 0;
    const y = top + plotH - barH;
    if (barH > 0) {
      root.append(svg("rect", { x: cx - barW / 2, y, width: barW, height: barH, rx: 4, fill: "var(--primary)" }));
      root.append(svg("text", { x: cx, y: y - 6, "text-anchor": "middle", class: "rec-chart-value" }, d.minutes));
    }
    root.append(svg("text", { x: cx, y: H - 8, "text-anchor": "middle", class: "rec-chart-day" }, WEEKDAYS[d.day.getDay()]));
  });
  return root;
}

function labeledRow(label, value) {
  return h("div", { class: "row" }, h("span", { class: "grow", text: label }), h("span", { class: "muted rec-value", text: value }));
}

export function mount(section, ctx) {
  let page = "stats";

  const statsButton = h("button", { type: "button", text: "統計", onclick: () => select("stats") });
  const collectionButton = h("button", { type: "button", text: "收藏", onclick: () => select("collection") });
  const segmented = h("div", { class: "segmented rec-segmented", attrs: { role: "group", "aria-label": "頁面" } },
    statsButton, collectionButton);

  const statsPane = h("div", { class: "rec-pane" });
  const collectionPane = h("div", { class: "rec-pane", hidden: true });

  section.append(h("h1", { class: "tab-title", text: "紀錄" }), segmented, statsPane, collectionPane);

  let lastStats = null;
  let lastCollection = null;

  function select(next) {
    page = next;
    render(ctx.state());
  }

  function renderStats(state) {
    const { records } = state.session;
    const now = state.now;
    const today = records.filter((r) => sameDay(r.date, now)).reverse();
    const titles = new Map(state.todos.map((t) => [t.id, t.title]));
    const signature = JSON.stringify([startOfDay(now).getTime(), records, today.map((r) => titles.get(r.todoID) ?? null)]);
    if (signature === lastStats) return;
    lastStats = signature;

    const overview = h("div", { class: "group" }, h("h2", { text: "總覽" }), h("div", { class: "group-body" },
      labeledRow("今天", `${minutesOn(records, now)} 分鐘`),
      labeledRow("本週", `${minutesThisWeek(records, now)} 分鐘`),
      labeledRow("連續專注", `${streak(records, now)} 天`),
      labeledRow("近 7 天成功率", rateText(successRate(records, now))),
    ));

    const chart = h("div", { class: "group" }, h("h2", { text: "最近 7 天" }),
      h("div", { class: "group-body rec-chart-wrap" }, barChart(lastDays(records, now))));

    const rows = today.map((r) => {
      const item = itemById(r.itemID);
      const todoTitle = r.todoID ? titles.get(r.todoID) : null;
      return h("div", { class: "row rec-record" },
        item ? h("span", { class: "rec-record-art" }, itemImage(item, { size: 22 })) : null,
        h("div", { class: "grow" },
          h("div", { class: "rec-record-head" },
            h("span", { class: "rec-time", text: timeText(r.date) }),
            h("span", { class: "muted", text: MODES[r.mode]?.title ?? "" })),
          todoTitle ? h("div", { class: "muted small-text rec-todo", text: todoTitle }) : null,
        ),
        h("span", { class: r.success ? "rec-minutes" : "rec-minutes muted", text: r.success ? `${r.minutes} 分鐘` : "放棄" }),
      );
    });
    const todayGroup = h("div", { class: "group" }, h("h2", { text: "今日紀錄" }),
      h("div", { class: "group-body" }, ...(rows.length ? rows : [h("div", { class: "row muted", text: "今天還沒有專注紀錄" })])));

    statsPane.replaceChildren(overview, chart, todayGroup);
  }

  function renderCollection(state) {
    const { records } = state.session;
    const counts = new Map();
    for (const r of records) counts.set(r.itemID, (counts.get(r.itemID) ?? 0) + 1);
    const giftCount = records.filter((r) => r.success).length;
    const trashCount = records.length - giftCount;
    const signature = JSON.stringify([giftCount, trashCount, [...counts]]);
    if (signature === lastCollection) return;
    lastCollection = signature;

    const group = (title, items) => h("div", { class: "group" }, h("h2", { class: "rec-grid-title", text: title }),
      h("div", { class: "rec-grid" }, ...items.map((item) => {
        const count = counts.get(item.id) ?? 0;
        return h("div", { class: "rec-tile" },
          h("div", { class: "rec-tile-art" }, itemImage(item, { silhouette: count === 0, size: 52 })),
          h("div", { class: "rec-tile-name", text: count > 0 ? item.name : "???" }),
          h("div", { class: "muted rec-tile-count", text: `× ${count}` }),
        );
      })));

    collectionPane.replaceChildren(group(`禮物 ${giftCount}`, GIFTS), group(`垃圾 ${trashCount}`, TRASH));
  }

  function render(state) {
    statsButton.setAttribute("aria-pressed", String(page === "stats"));
    collectionButton.setAttribute("aria-pressed", String(page === "collection"));
    statsPane.hidden = page !== "stats";
    collectionPane.hidden = page !== "collection";
    if (page === "stats") renderStats(state);
    else renderCollection(state);
  }

  // Like TimelineView(.everyMinute): keeps "today" right across midnight.
  setInterval(() => {
    if (!section.hidden && !document.hidden) {
      try { render(ctx.state()); } catch (error) { ctx.report(error); }
    }
  }, 60_000);

  return { render };
}
