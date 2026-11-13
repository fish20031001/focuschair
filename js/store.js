// Persistence in localStorage. Every write goes through update(), which holds
// the Web Locks lock "focuschair" and re-reads the stored value inside it, so
// tabs never overwrite each other with stale copies. Without a lock manager
// the store refuses to write at all (no uncoordinated fallback).

// All state lives in ONE localStorage value, so every write (an action, an
// import) is a single setItem: other tabs can never see half of a change,
// and a failed write (e.g. quota) leaves the previous state untouched.
const STATE_KEY = "focuschair.v1";
const LOCK = "focuschair";
const MODES = ["pomodoro", "stopwatch"];
export const RESULT_LIMIT = 20;

export const DEFAULTS = {
  settings: { mode: "pomodoro", focusMinutes: 25, breakMinutes: 5, keepAwake: true, linkedTodoID: null },
  // active: null | { id, phase: "focusing" | "breaking", mode, start, end, todoID }
  // results: completion events [{ id }] (id = a record id), newest last, at
  // most RESULT_LIMIT. Every tab presents each new event once (see focus.js).
  // An import clears them, so imported history is never replayed.
  session: { active: null, records: [], lastDrop: null, results: [] },
  todos: [],
  shop: { purchased: [], equipped: {} },
  sound: { volumes: { rain: 0, fire: 0, waves: 0, clock: 0 }, playDuringBreak: false },
};

export const KEYS = Object.keys(DEFAULTS);

export class LocksUnavailableError extends Error {
  constructor() {
    super("Web Locks API is unavailable");
    this.name = "LocksUnavailableError";
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Fills in defaults for missing fields, e.g. records saved before todoID existed. */
function normalize(key, value) {
  const base = clone(DEFAULTS[key]);
  if (value == null) return base;
  switch (key) {
    case "settings":
    case "sound":
      return { ...base, ...value, ...(key === "sound" ? { volumes: { ...base.volumes, ...value.volumes } } : {}) };
    case "session":
      return {
        active: value.active ?? null,
        records: (value.records ?? []).map((r) => ({ ...r, todoID: r.todoID ?? null })),
        lastDrop: value.lastDrop ?? null,
        results: Array.isArray(value.results) ? value.results : [],
        importGen: value.importGen ?? null,
      };
    case "shop":
      return { purchased: value.purchased ?? [], equipped: value.equipped ?? {} };
    default:
      return value;
  }
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isString = (v) => typeof v === "string";
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

const isInt = (v) => Number.isInteger(v);
const isBool = (v) => typeof v === "boolean";
const isOptString = (v) => v == null || isString(v);
const SLOTS = ["chair", "rug", "wall", "floor"];
const PHASES = ["focusing", "breaking"];
const SOUNDS = ["rain", "fire", "waves", "clock"];

function unique(list, what, fail) {
  const ids = list.map((x) => x.id);
  if (new Set(ids).size !== ids.length) fail(`duplicate ${what} id`);
}

/**
 * Throws with a reason when an imported value is not a state the app can run
 * from. Fields that older data may lack (todoID, keepAwake, lastDrop...) may
 * be absent; anything present must be valid.
 */
const STOPWATCH_MAX = 180;

function validate(key, value, minute) {
  const fail = (why) => { throw new Error(`${key}: ${why}`); };
  switch (key) {
    case "settings":
      if (!isObject(value) || !MODES.includes(value.mode)) fail("invalid mode");
      if (!isInt(value.focusMinutes) || value.focusMinutes < 5 || value.focusMinutes > 120 || value.focusMinutes % 5) fail("invalid focus minutes");
      if (!isInt(value.breakMinutes) || value.breakMinutes < 1 || value.breakMinutes > 30) fail("invalid break minutes");
      if (value.keepAwake !== undefined && !isBool(value.keepAwake)) fail("invalid keepAwake");
      if (!isOptString(value.linkedTodoID)) fail("invalid linked to-do");
      break;
    case "session": {
      if (!isObject(value) || !Array.isArray(value.records)) fail("records missing");
      for (const r of value.records) {
        if (!isObject(r) || !isString(r.id) || !r.id || !isNumber(r.date) || !isBool(r.success)
          || !isString(r.itemID) || !MODES.includes(r.mode) || !isOptString(r.todoID)) fail("bad record");
        // Minutes a session of that mode can actually have.
        const max = r.mode === "stopwatch" ? STOPWATCH_MAX : 120;
        if (!Number.isSafeInteger(r.minutes) || r.minutes < 0 || r.minutes > max) fail("bad record minutes");
      }
      unique(value.records, "record", fail);
      const a = value.active;
      if (a != null) {
        if (!isObject(a) || !isString(a.id) || !a.id || !PHASES.includes(a.phase) || !isNumber(a.start) || !isNumber(a.end)
          || a.end <= a.start) fail("bad active session");
        if (a.phase === "focusing" && (!MODES.includes(a.mode) || !isOptString(a.todoID))) fail("bad active focus session");
        if (value.records.some((r) => r.id === a.id)) fail("active session already recorded");
        // The duration must be one the app can create (in this app's minute
        // length, which the localhost dev clock shortens).
        const minutes = (a.end - a.start) / minute;
        const allowed = a.phase === "breaking"
          ? isInt(minutes) && minutes >= 1 && minutes <= 30
          : a.mode === "stopwatch"
            ? minutes === STOPWATCH_MAX
            : isInt(minutes) && minutes >= 5 && minutes <= 120 && minutes % 5 === 0;
        if (!allowed) fail("active session has an impossible duration");
      }
      if (value.results !== undefined) {
        const ids = new Set(value.records.map((r) => r.id));
        if (!Array.isArray(value.results) || value.results.some((e) => !isObject(e) || !ids.has(e.id))) fail("bad results");
      }
      if (!isOptString(value.lastDrop)) fail("bad lastDrop");
      break;
    }
    case "todos":
      if (!Array.isArray(value)) fail("not a list");
      for (const t of value) {
        if (!isObject(t) || !isString(t.id) || !t.id || !isString(t.title) || !t.title.trim() || !isBool(t.done)
          || (t.createdAt !== undefined && !isNumber(t.createdAt)) || (t.doneAt != null && !isNumber(t.doneAt))) fail("bad to-do");
      }
      unique(value, "to-do", fail);
      break;
    case "shop":
      if (!isObject(value) || !Array.isArray(value.purchased) || !value.purchased.every(isString)
        || new Set(value.purchased).size !== value.purchased.length || !isObject(value.equipped)) fail("bad shop");
      for (const [slot, id] of Object.entries(value.equipped)) {
        if (!SLOTS.includes(slot) || !isString(id)) fail("bad equipped slot");
      }
      break;
    case "sound":
      if (!isObject(value) || !isObject(value.volumes)) fail("bad sound");
      for (const [sound, volume] of Object.entries(value.volumes)) {
        if (!SOUNDS.includes(sound) || !isNumber(volume) || volume < 0 || volume > 1) fail("bad volume");
      }
      if (value.playDuringBreak !== undefined && !isBool(value.playDuringBreak)) fail("bad playDuringBreak");
      break;
    default:
      fail("unknown key");
  }
}

/**
 * @param {{ storage: Storage, locks?: { request(name: string, cb: () => any): Promise<any> }, minute?: number }} deps
 *   minute: milliseconds per minute, used to validate imported session lengths
 */
export function createStore({ storage, locks, minute = 60_000 }) {
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => fn());

  function readState() {
    try {
      const parsed = JSON.parse(storage.getItem(STATE_KEY));
      return isObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function read(key) {
    return normalize(key, readState()[key] ?? null);
  }

  /** Replaces the given keys in one write; on failure nothing has changed. */
  function writeAll(values) {
    storage.setItem(STATE_KEY, JSON.stringify({ ...readState(), ...values }));
  }

  function withLock(task) {
    if (!locks || typeof locks.request !== "function") {
      return Promise.reject(new LocksUnavailableError());
    }
    return locks.request(LOCK, task);
  }

  return {
    canWrite: Boolean(locks && typeof locks.request === "function"),

    read,

    readAll() {
      return Object.fromEntries(KEYS.map((key) => [key, read(key)]));
    },

    /** Applies fn to the freshest stored value under the lock and saves its return value. */
    update(key, fn) {
      return this.transact(key, (current) => {
        const value = fn(current);
        return { value, result: value };
      });
    },

    /**
     * Like update, but fn returns { value, result }: value is saved and
     * result is what the promise resolves to.
     */
    transact(key, fn) {
      return this.transactMany([key], (values) => {
        const outcome = fn(values[key]);
        return { values: { [key]: outcome.value }, result: outcome.result };
      });
    },

    /**
     * Reads several keys fresh under one lock. fn(values) returns
     * { values: { key: newValue, ... }, result }; only the keys it returns
     * are written.
     */
    async transactMany(keys, fn) {
      const result = await withLock(async () => {
        const values = Object.fromEntries(keys.map((key) => [key, read(key)]));
        const outcome = fn(values);
        writeAll(outcome.values ?? {});
        return outcome.result;
      });
      notify();
      return result;
    },

    /**
     * A backup of everything, read under the lock so it can never mix values
     * from before and after another tab's write (or catch a rollback midway).
     */
    exportAll() {
      return withLock(async () =>
        JSON.stringify({ app: "focuschair", version: 1, exportedAt: Date.now(), data: this.readAll() }, null, 2));
    },

    /** Validates everything first; on any error nothing is written. */
    async importAll(text) {
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("不是有效的 JSON 檔案");
      }
      if (!isObject(parsed) || parsed.app !== "focuschair" || parsed.version !== 1 || !isObject(parsed.data)) {
        throw new Error("不是專注椅子的備份檔");
      }
      // A backup must be complete: importing part of one (say, history
      // without purchases) could leave the data inconsistent.
      for (const key of KEYS) {
        if (parsed.data[key] === undefined) throw new Error(`${key}: missing from the backup`);
        validate(key, parsed.data[key], minute);
      }
      const next = Object.fromEntries(KEYS.map((key) => [key, normalize(key, parsed.data[key])]));
      // Completion events are not part of history: imported sessions must not
      // pop up as new results in any open tab. A new generation tells every
      // open tab that the data was replaced.
      next.session.results = [];
      next.session.importGen = crypto.randomUUID?.() ?? String(Date.now());
      await withLock(async () => writeAll(next));
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Re-render when another tab changes our keys. */
    watch(target) {
      target.addEventListener("storage", (event) => {
        if (event.key == null || event.key === STATE_KEY) notify();
      });
    },
  };
}
