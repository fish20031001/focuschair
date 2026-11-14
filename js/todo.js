// 待辦 tab, ported from TodoView.swift: add, rename, toggle, delete, and the
// minutes focused on each to-do. Every write re-reads the stored list inside
// store.update, so edits from other tabs are never lost.
import { h, icon, confirmDialog, openSheet } from "./ui.js";

const trimmed = (text) => text.replace(/^\s+|\s+$/g, "");

/** Minutes of successful sessions linked to each to-do id. */
function focusedMinutes(records) {
  const map = new Map();
  for (const r of records) {
    if (r.success && r.todoID) map.set(r.todoID, (map.get(r.todoID) ?? 0) + r.minutes);
  }
  return map;
}

export function mount(section, ctx) {
  const { store } = ctx;

  // ---- static skeleton ----
  const input = h("input", {
    class: "todo-input",
    type: "text",
    placeholder: "新增待辦",
    attrs: { "aria-label": "新增待辦", enterkeyhint: "done", autocomplete: "off" },
  });
  const addButton = h("button", { class: "btn primary small todo-add-btn", type: "submit", text: "新增", disabled: true });
  const form = h("form", { class: "row todo-add", attrs: { novalidate: true } }, input, addButton);

  const openBody = h("div", { class: "group-body" });
  const doneBody = h("div", { class: "group-body" });
  const doneGroup = h("div", { class: "group", hidden: true }, h("h2", { text: "已完成" }), doneBody);

  section.append(
    h("h1", { class: "tab-title", text: "待辦" }),
    h("div", { class: "group" }, h("div", { class: "group-body" }, form)),
    h("div", { class: "group" }, h("h2", { text: "未完成" }), openBody),
    doneGroup,
  );

  let adding = false; // one save at a time, so a double tap cannot add twice
  const syncAddButton = () => { addButton.disabled = adding || trimmed(input.value) === ""; };
  input.addEventListener("input", syncAddButton);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submitted = input.value;
    const title = trimmed(submitted);
    if (!title || adding) return;
    adding = true;
    syncAddButton();
    const todo = { id: crypto.randomUUID(), title, done: false, createdAt: Date.now(), doneAt: null };
    // The text stays until it is saved, so a failed save can be retried;
    // it is cleared only if the user has not typed something else since.
    store.update("todos", (todos) => [...todos, todo])
      .then(() => {
        if (input.value === submitted) input.value = "";
      })
      .catch(ctx.report)
      .finally(() => {
        adding = false;
        syncAddButton();
      });
  });

  // ---- actions ----
  function toggle(id) {
    store.update("todos", (todos) => todos.map((t) => (t.id === id
      ? { ...t, done: !t.done, doneAt: t.done ? null : Date.now() }
      : t))).catch(ctx.report);
  }

  function rename(todo) {
    const field = h("input", {
      class: "todo-input",
      type: "text",
      value: todo.title,
      attrs: { "aria-label": "名稱", autocomplete: "off", enterkeyhint: "done" },
    });
    const save = h("button", { class: "btn primary block", type: "submit", text: "儲存" });
    let saving = false; // while the rename is being saved, field and button are locked
    const sync = () => { save.disabled = saving || trimmed(field.value) === ""; };
    field.addEventListener("input", sync);
    const renameForm = h("form", { class: "todo-rename" }, field, save);
    const sheet = openSheet({ title: "重新命名", content: renameForm });
    renameForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const title = trimmed(field.value);
      if (!title || saving) return;
      // The sheet closes only once the new name is saved. Until then the
      // field is locked, so nothing typed can be lost; on failure it is
      // unlocked with the submitted text still in it.
      saving = true;
      field.readOnly = true;
      sync();
      store.update("todos", (todos) => todos.map((t) => (t.id === todo.id ? { ...t, title } : t)))
        .then(() => sheet.close())
        .catch((error) => {
          saving = false;
          field.readOnly = false;
          sync();
          ctx.report(error);
        });
    });
    field.focus();
    field.select();
  }

  async function remove(todo) {
    const ok = await confirmDialog({ title: `刪除「${todo.title}」？`, confirmLabel: "刪除", destructive: true });
    if (!ok) return;
    store.update("todos", (todos) => todos.filter((t) => t.id !== todo.id)).catch(ctx.report);
  }

  // ---- rows ----
  function row(todo, minutes) {
    const label = todo.done ? "標記為未完成" : "標記為完成";
    return h("div", { class: `row todo-row${todo.done ? " done" : ""}` },
      h("button", {
        class: "icon-btn todo-toggle",
        type: "button",
        attrs: { "aria-label": label, "data-key": `toggle:${todo.id}` },
        onclick: () => toggle(todo.id),
      }, icon(todo.done ? "check" : "circle")),
      h("div", { class: "grow todo-text" },
        h("div", { class: "todo-title", text: todo.title }),
        minutes > 0 ? h("div", { class: "muted small-text", text: `已專注 ${minutes} 分鐘` }) : null,
      ),
      h("button", {
        class: "icon-btn todo-action",
        type: "button",
        attrs: { "aria-label": `重新命名「${todo.title}」`, "data-key": `rename:${todo.id}` },
        onclick: () => rename(todo),
      }, icon("pencil")),
      h("button", {
        class: "icon-btn todo-action todo-delete",
        type: "button",
        attrs: { "aria-label": `刪除「${todo.title}」`, "data-key": `delete:${todo.id}` },
        onclick: () => remove(todo),
      }, icon("trash")),
    );
  }

  let lastSignature = null;

  function render(state) {
    const minutes = focusedMinutes(state.session.records);
    const open = state.todos.filter((t) => !t.done);
    const finished = state.todos.filter((t) => t.done)
      .sort((a, b) => (b.doneAt ?? -Infinity) - (a.doneAt ?? -Infinity));

    const signature = JSON.stringify([
      open.map((t) => [t.id, t.title, minutes.get(t.id) ?? 0]),
      finished.map((t) => [t.id, t.title, minutes.get(t.id) ?? 0]),
    ]);
    if (signature === lastSignature) return;
    lastSignature = signature;

    // Keep keyboard focus on the same control after rebuilding the lists.
    const focusedKey = section.contains(document.activeElement) ? document.activeElement.dataset?.key : null;

    openBody.replaceChildren(...(open.length
      ? open.map((t) => row(t, minutes.get(t.id) ?? 0))
      : [h("div", { class: "row muted", text: "沒有待辦事項" })]));
    doneBody.replaceChildren(...finished.map((t) => row(t, minutes.get(t.id) ?? 0)));
    doneGroup.hidden = finished.length === 0;

    if (focusedKey) {
      const target = [...section.querySelectorAll("[data-key]")].find((el) => el.dataset.key === focusedKey);
      target?.focus({ preventScroll: true });
    }
  }

  return { render };
}
