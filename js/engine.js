// Focus and break sessions, stored as absolute timestamps so reloads and
// locked screens keep counting. The store is the source of truth: every
// action re-reads it under the lock, and completion is idempotent per session
// id, so two tabs can never record or reward the same session twice.
import {
  STOPWATCH_MAX_MINUTES, STOPWATCH_MIN_MINUTES, itemById, randomGift, randomTrash,
} from "./catalog.js";
import { reward } from "./economy.js";
import { RESULT_LIMIT } from "./store.js";

const MINUTE = 60_000;

/**
 * @param {{ store, now?: () => number, random?: () => number, uuid?: () => string, minute?: number }} deps
 *   minute: milliseconds per minute (60000; the localhost dev clock shrinks it)
 */
export function createEngine({ store, now = Date.now, random = Math.random, uuid = () => crypto.randomUUID(), minute = MINUTE }) {
  function active() {
    return store.read("session").active;
  }

  /**
   * Resolves the focusing session `id`, exactly once, inside the lock:
   * - at or after its end time it is always a success at the end time
   *   (an action that arrives just after the deadline cannot turn it into a failure);
   * - before the end, "giveUp" fails it, "finish" succeeds only past the
   *   stopwatch minimum, and "expire" does nothing.
   * Resolves to the result to show for the call that recorded it, else null
   * (already recorded, a different session, or nothing to do).
   */
  async function complete(id, action) {
    return store.transact("session", (session) => {
      const current = session.active;
      if (!current || current.id !== id || current.phase !== "focusing") {
        return { value: session, result: null };
      }
      if (session.records.some((r) => r.id === id)) {
        return { value: { ...session, active: null }, result: null };
      }
      const t = now();
      let success;
      let at = t;
      if (t >= current.end) {
        success = true;
        at = current.end;
      } else if (action === "giveUp") {
        success = false;
      } else if (action === "finish") {
        // Only a count-up session can be finished early; a pomodoro cannot.
        if (current.mode !== "stopwatch") return { value: session, result: null };
        success = t - current.start >= STOPWATCH_MIN_MINUTES * minute;
      } else {
        return { value: session, result: null };
      }
      // Clamped to the session's own length, so a clock moved backwards can
      // never produce negative minutes (or more than the session allowed).
      const elapsed = Math.min(Math.max(at - current.start, 0), current.end - current.start);
      const minutes = Math.floor(elapsed / minute);
      const item = success ? randomGift(minutes, random) : randomTrash(random);
      const record = {
        id, date: current.start, minutes, success, itemID: item.id, mode: current.mode, todoID: current.todoID ?? null,
      };
      const earnedReward = success ? reward(minutes, item.rarity) : 0;
      return {
        value: {
          ...session, // keeps importGen and any other metadata
          active: null,
          records: [...session.records, record],
          lastDrop: item.id,
          results: [...session.results, { id }].slice(-RESULT_LIMIT),
        },
        result: { success, item, minutes, mode: current.mode, reward: earnedReward },
      };
    });
  }

  return {
    active,

    /**
     * Starts a focus session. Settings, to-dos and the session are read and
     * written under one lock, so a concurrent settings change or to-do
     * toggle in another tab is either fully before or fully after the start.
     * A link to a to-do that is no longer open is cleared.
     */
    async startFocus() {
      const start = now();
      return store.transactMany(["settings", "todos", "session"], ({ settings, todos, session }) => {
        if (session.active) return { values: {}, result: null };
        const linked = settings.linkedTodoID;
        const valid = linked && todos.some((t) => t.id === linked && !t.done);
        const minutes = settings.mode === "pomodoro" ? settings.focusMinutes : STOPWATCH_MAX_MINUTES;
        const active = {
          id: uuid(), phase: "focusing", start, end: start + minutes * minute, mode: settings.mode, todoID: valid ? linked : null,
        };
        return {
          values: {
            session: { ...session, lastDrop: null, active },
            ...(linked && !valid ? { settings: { ...settings, linkedTodoID: null } } : {}),
          },
          result: active,
        };
      });
    },

    async startBreak() {
      const start = now();
      return store.transactMany(["settings", "session"], ({ settings, session }) => {
        if (session.active) return { values: {}, result: null };
        const active = { id: uuid(), phase: "breaking", start, end: start + settings.breakMinutes * minute };
        return { values: { session: { ...session, lastDrop: null, active } }, result: active };
      });
    },

    /**
     * Gives up the focusing session `id` (capture it before asking for
     * confirmation); does nothing if that session is no longer active.
     */
    async giveUp(id = active()?.id) {
      return id ? complete(id, "giveUp") : null;
    },

    /** Ends count-up session `id`; under the minimum it counts as giving up. */
    async finishStopwatch(id = active()?.id) {
      return id ? complete(id, "finish") : null;
    },

    /** Ends break `id` early; does nothing if that break is no longer active. */
    async skipBreak(id = active()?.id) {
      return store.update("session", (session) =>
        session.active?.phase === "breaking" && session.active.id === id ? { ...session, active: null } : session);
    },

    /**
     * Completes an expired focus session (as a success at its end time) or
     * ends an expired break. Safe to call from every tab on every tick.
     */
    async tick() {
      const current = active();
      if (!current || now() < current.end) return null;
      if (current.phase === "focusing") return complete(current.id, "expire");
      await store.update("session", (session) =>
        session.active?.id === current.id && now() >= session.active.end ? { ...session, active: null } : session);
      return null;
    },

    elapsedMs() {
      const current = active();
      return current ? Math.max(0, now() - current.start) : 0;
    },

    remainingMs() {
      const current = active();
      return current ? Math.max(0, current.end - now()) : 0;
    },

    canFinishStopwatch() {
      return this.elapsedMs() >= STOPWATCH_MIN_MINUTES * minute;
    },

    /** Seconds for the big clock. */
    displaySeconds() {
      const current = active();
      if (!current) {
        const settings = store.read("settings");
        return settings.mode === "pomodoro" ? settings.focusMinutes * 60 : 0;
      }
      const scale = MINUTE / minute;
      if (current.phase === "focusing" && current.mode === "stopwatch") {
        return Math.floor((this.elapsedMs() * scale) / 1000);
      }
      return Math.ceil((this.remainingMs() * scale) / 1000);
    },

    progress() {
      const current = active();
      if (!current) return 0;
      const total = current.end - current.start;
      return total > 0 ? Math.min(this.elapsedMs() / total, 1) : 0;
    },

    lastDrop() {
      return itemById(store.read("session").lastDrop);
    },
  };
}
