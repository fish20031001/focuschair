// Small DOM helpers shared by every UI module: an element builder, icons,
// confirm dialogs, bottom sheets, toasts, item art and coin labels.
import { CURRENCY, itemAsset } from "./catalog.js";

/**
 * h("button", { class: "btn", onclick: fn, attrs: { "aria-label": "x" } }, "text", child)
 * Props: class, text, html (trusted static SVG only), attrs, dataset, on<event>,
 * and any other key is set as a property (value, disabled, hidden, ...).
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false && key !== "value" && key !== "checked" && key !== "disabled" && key !== "hidden") continue;
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key === "html") el.innerHTML = value;
    else if (key === "attrs") for (const [a, v] of Object.entries(value)) { if (v != null && v !== false) el.setAttribute(a, v === true ? "" : v); }
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else el[key] = value;
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const ICONS = {
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
  checklist: '<path d="M10 6h10M10 12h10M10 18h10"/><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5 2.5-2.5M3.5 18l1.5 1.5 2.5-2.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m7.5 12 3 3 6-6"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="M7 5v14l11-7L7 5Z"/>',
  pencil: '<path d="m4 20 4-1 11-11-3-3L5 16l-1 4Z"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};

export function icon(name) {
  const span = h("span", { attrs: { "aria-hidden": "true" } });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ""}</svg>`;
  return span;
}

/** Replaces every [data-icon] placeholder inside root with its SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => {
    el.replaceWith(icon(el.dataset.icon));
  });
}

/** Resolves true when confirmed. */
export function confirmDialog({ title, message = "", confirmLabel = "確定", cancelLabel = "取消", destructive = false }) {
  return new Promise((resolve) => {
    const dialog = h("dialog", { class: "alert", attrs: { "aria-labelledby": "alert-title" } },
      h("h2", { id: "alert-title", text: title }),
      message ? h("p", { text: message }) : null,
      h("div", { class: "actions" },
        h("button", { class: `btn primary block${destructive ? " danger" : ""}`, type: "button", text: confirmLabel, onclick: () => finish(true) }),
        h("button", { class: "btn block", type: "button", text: cancelLabel, onclick: () => finish(false) }),
      ));
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    }
    dialog.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** A bottom sheet. Returns { close, body }. onClose runs once however it closes. */
export function openSheet({ title, content, onClose }) {
  const body = h("div", { class: "sheet-body" }, content);
  const dialog = h("dialog", { class: "sheet", attrs: { "aria-label": title } },
    h("div", { class: "sheet-head" },
      h("h2", { text: title }),
      h("button", { class: "icon-btn", type: "button", attrs: { "aria-label": "關閉" }, onclick: () => close() }, icon("close")),
    ),
    body);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    onClose?.();
  }
  dialog.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
  return { close, body };
}

let toastTimer = null;
/**
 * A short message. It is placed inside the topmost open dialog when there is
 * one, because a modal dialog sits in the top layer above everything in the
 * page body. Errors use role="alert" and stay longer.
 */
export function toast(text, { error = false } = {}) {
  document.querySelectorAll(".toast").forEach((old) => old.remove());
  const el = h("div", { class: "toast", attrs: { role: error ? "alert" : "status" }, text });
  const host = [...document.querySelectorAll("dialog[open]")].pop() ?? document.body;
  host.append(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), error ? 6000 : 2600);
}

/** Item art; a grey silhouette (with alt "尚未收集") for items not collected yet. */
export function itemImage(item, { silhouette = false, size } = {}) {
  const img = h("img", {
    src: itemAsset(item),
    alt: silhouette ? "尚未收集" : item.name,
    class: silhouette ? "silhouette" : "",
    attrs: size ? { width: size, height: size } : {},
    draggable: false,
  });
  img.addEventListener("error", () => {
    const fallback = h("span", { class: `emoji-fallback${silhouette ? " silhouette" : ""}`, attrs: { role: "img", "aria-label": img.alt }, text: item.emoji });
    img.replaceWith(fallback);
  }, { once: true });
  return img;
}

export function coinLabel(amount, prefix = "") {
  return h("span", { class: "coin", attrs: { "aria-label": `${prefix}${amount} ${CURRENCY}` } },
    h("img", { src: "assets/coin.png", alt: "" }),
    `${prefix}${amount}`);
}

export function clockText(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}
