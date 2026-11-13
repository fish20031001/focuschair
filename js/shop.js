// 商店 tab, ported from ShopView.swift. Purchases re-check the balance inside
// store.update against the freshest records and shop, so a stale tab can
// never overspend or drop a purchase made elsewhere.
import { h, confirmDialog, toast, coinLabel } from "./ui.js";
import { DECOR, DECOR_SLOTS, CURRENCY, assetPath } from "./catalog.js";
import * as economy from "./economy.js";

export function mount(section, ctx) {
  const { store } = ctx;

  const balanceSlot = h("div", { class: "shop-balance" });
  const groups = h("div", { class: "shop-groups" });
  section.append(
    h("h1", { class: "tab-title", text: "商店" }),
    h("div", { class: "group" }, h("div", { class: "group-body" },
      h("div", { class: "row shop-balance-row" },
        balanceSlot,
        h("span", { class: "muted small-text shop-hint", text: `完成專注就能得到${CURRENCY}` })))),
    groups,
  );

  async function buy(decor) {
    const ok = await confirmDialog({ title: `購買${decor.name}？`, confirmLabel: `花 ${decor.price} ${CURRENCY}購買` });
    if (!ok) return;
    let outcome = "short";
    await store.update("shop", (s) => {
      if (economy.owns(s, decor)) { outcome = "owned"; return s; }
      const next = economy.purchase(s, decor, economy.balance(store.read("session").records, s));
      if (next) outcome = "bought";
      return next ?? s;
    });
    if (outcome === "short") toast(`${CURRENCY}不夠`);
  }

  function equip(decor) {
    store.update("shop", (s) => economy.equip(s, decor)).catch(ctx.report);
  }

  function putAway(slotId) {
    store.update("shop", (s) => economy.clear(s, slotId)).catch(ctx.report);
  }

  function actionButton(decor, shop, balance) {
    const key = `action:${decor.id}`;
    if (economy.isEquipped(shop, decor)) {
      return h("button", { class: "btn small shop-action", type: "button", text: "已裝備", disabled: true, attrs: { "data-key": key } });
    }
    if (economy.owns(shop, decor)) {
      return h("button", { class: "btn small shop-action", type: "button", text: "裝備", attrs: { "data-key": key, "aria-label": `裝備${decor.name}` }, onclick: () => equip(decor) });
    }
    return h("button", {
      class: "btn small primary shop-action",
      type: "button",
      text: "購買",
      disabled: balance < decor.price,
      attrs: { "data-key": key, "aria-label": `購買${decor.name}` },
      onclick: () => buy(decor).catch(ctx.report),
    });
  }

  let lastSignature = null;

  function render(state) {
    const shop = state.shop;
    const balance = economy.balance(state.session.records, shop);
    const signature = JSON.stringify([balance, shop]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    const focusedKey = section.contains(document.activeElement) ? document.activeElement.dataset?.key : null;

    balanceSlot.replaceChildren(coinLabel(balance));

    groups.replaceChildren(...DECOR_SLOTS.map((slot) => {
      const rows = DECOR.filter((d) => d.slot === slot.id).map((decor) => h("div", { class: "row shop-row" },
        h("img", { class: "shop-art", src: assetPath(decor.asset), alt: "", draggable: false, attrs: { width: 56, height: 56 } }),
        h("div", { class: "grow" },
          h("div", { class: "shop-name", text: decor.name }),
          h("div", { class: "muted small-text shop-price" }, decor.price === 0 ? "免費" : coinLabel(decor.price))),
        actionButton(decor, shop, balance),
      ));
      if (slot.allowsNone && economy.current(shop, slot.id)) {
        rows.push(h("div", { class: "row shop-clear-row" },
          h("button", {
            class: "shop-clear",
            type: "button",
            text: `收起${slot.title}`,
            attrs: { "data-key": `clear:${slot.id}` },
            onclick: () => putAway(slot.id),
          })));
      }
      return h("div", { class: "group" }, h("h2", { text: slot.title }), h("div", { class: "group-body" }, ...rows));
    }));

    if (focusedKey) {
      const target = [...section.querySelectorAll("[data-key]")].find((el) => el.dataset.key === focusedKey);
      if (target && !target.disabled) target.focus({ preventScroll: true });
    }
  }

  return { render };
}
