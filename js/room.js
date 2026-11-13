// The room scene: wall, window, rug, chair, decor, the character and whatever
// it dropped. A port of RoomView.swift and CharacterView.swift.
//
//   const room = createRoom(container);
//   room.update({ mood, onChair, drop, decor });   // cheap and idempotent
import { CHARACTER, greetingLine, pokeLine, assetPath } from "./catalog.js";
import { h, itemImage } from "./ui.js";

// The frame is 361:320, so every position can be a fixed percentage of the
// frame's width (x, w) or height (y, h). R converts width units to height units.
const R = 361 / 320;
const FLOOR_Y = 0.72;
const pct = (v) => `${(v * 100).toFixed(4)}%`;

const CHAIR_H = 0.46;
const CHAIR_W = (CHAIR_H * 0.833) / R;          // room_chair's aspect ratio
const CHAIR_X = 0.62;
const CHAIR_BOTTOM = FLOOR_Y + 0.06;
const SEAT_TOP = CHAIR_BOTTOM - CHAIR_H * 0.5;

const CHAR_H = 0.62;
const CHAR_W = (CHAR_H * CHARACTER.aspect) / R;

const DROP_W = 0.14;
const DROP_H = DROP_W * R;
const DROP_FALL = 0.7 / DROP_H;                  // 0.7h, in units of the drop's own height

const HOP_LIFT = 0.16 / CHAR_H;                  // 0.16h, in units of the character's own height

const SPRING = "cubic-bezier(0.34, 1.3, 0.64, 1)";
const BOUNCY = "cubic-bezier(0.34, 1.56, 0.64, 1)";

const MOODS = ["idle", "focus", "happy", "sad", "sleep"];
const FLAME_SCALE = { happy: 1.3, sad: 0.6, sleep: 0.001, idle: 1, focus: 1 };
const FLAME_OPACITY = { sleep: 0, sad: 0.7 };

/** Top-left of the character box (fractions of w and h) for each place. */
function characterBox(onChair) {
  const [ax, ay, tx, ty] = onChair
    ? [CHARACTER.bodyX, CHARACTER.seatY, CHAIR_X, SEAT_TOP]
    : [CHARACTER.bodyX, CHARACTER.feetY, 0.30, FLOOR_Y + 0.08];
  return { left: tx - ax * CHAR_W, top: ty - ay * CHAR_H };
}

function place(el, { left, top, width, height }) {
  Object.assign(el.style, { left: pct(left), top: pct(top), width: pct(width), height: pct(height) });
}

/** Centre (cx, cy) and size, as fractions, to a positioned box. */
function placeCentered(el, cx, cy, width, height) {
  place(el, { left: cx - width / 2, top: cy - height / 2, width, height });
}

const spriteSrc = (name) => assetPath(`character_${name}`);

// Every sprite stays loaded (and referenced) so swapping the body src never flashes.
const spriteCache = new Map();
function preloadSprites() {
  for (const name of [...MOODS, "blink", "flame"]) {
    if (spriteCache.has(name)) continue;
    const img = new Image();
    img.src = spriteSrc(name);
    img.decode?.().catch(() => {});
    spriteCache.set(name, img);
  }
}

export function createRoom(container) {
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = () => reducedQuery.matches;

  preloadSprites();

  // ---- static scene ----
  const wall = h("img", { class: "room-wall", src: assetPath("room_wall"), alt: "", draggable: false });
  const win = h("img", { class: "room-piece", src: assetPath("room_window"), alt: "", draggable: false });
  placeCentered(win, 0.84, 0.24, 0.24, (0.24 / 1.04) * R);

  const wallSlot = h("div", { class: "room-piece room-slot" });
  placeCentered(wallSlot, 0.40, 0.24, 0.17, 0.17 * R);

  const rugSlot = h("div", { class: "room-piece room-slot" });
  placeCentered(rugSlot, CHAIR_X, FLOOR_Y + 0.09, 0.56, (0.56 / 4.5) * R);

  const chairSlot = h("div", { class: "room-piece room-slot" });
  place(chairSlot, { left: CHAIR_X - CHAIR_W / 2, top: CHAIR_BOTTOM - CHAIR_H, width: CHAIR_W, height: CHAIR_H });

  // Floor decor art is 180x320 with the object's base on the bottom edge.
  const floorSlot = h("div", { class: "room-piece room-slot" });
  const floorH = 0.30;
  const floorW = (floorH * 180 / 320) / R;
  place(floorSlot, { left: 0.90 - floorW / 2, top: FLOOR_Y + 0.10 - floorH, width: floorW, height: floorH });

  const dropSlot = h("div", { class: "room-piece room-slot room-drop" });
  placeCentered(dropSlot, 0.47, FLOOR_Y + 0.15, DROP_W, DROP_H);

  // ---- character ----
  const body = h("img", { class: "room-char-body", src: spriteSrc("idle"), alt: "", draggable: false });
  const flameImg = h("img", { class: "room-flame", src: spriteSrc("flame"), alt: "", draggable: false });
  const flameMood = h("div", { class: "room-flame-mood" }, flameImg);
  const canvas = h("canvas", { class: "room-particles", attrs: { "aria-hidden": "true" } });
  const ambient = h("div", { class: "room-char-ambient" }, body, flameMood, canvas);
  const hopper = h("div", { class: "room-char-hop" }, ambient);
  const character = h("button", {
    class: "room-char",
    type: "button",
    attrs: { "aria-label": `${CHARACTER.name}，戳一下` },
    onclick: poke,
  }, hopper);
  const origin = `${pct(CHARACTER.flameCenter.x)} ${pct(CHARACTER.flameCenter.y)}`;
  flameMood.style.transformOrigin = origin;
  flameImg.style.transformOrigin = origin;
  character.style.width = pct(CHAR_W);
  character.style.height = pct(CHAR_H);

  // ---- speech bubble ----
  const bubbleAnchor = h("div", { class: "room-bubble-anchor", attrs: { "aria-live": "polite" } });

  const frame = h("div", { class: "room-frame" },
    wall, win, wallSlot, rugSlot, chairSlot, floorSlot, dropSlot, character, bubbleAnchor);
  container.replaceChildren(frame);

  // ---- state ----
  let state = null;            // last inputs applied
  let tickled = false;
  let tickleTimer = null;
  let blinking = false;
  let blinkTimer = null;
  let shownMood = null;
  let moveSeq = 0;
  let lineSeq = 0;
  let lineTimer = null;
  let rafId = 0;
  let colors = null;
  const decorNames = { chair: undefined, rug: undefined, wall: undefined, floor: undefined };
  const slots = { chair: chairSlot, rug: rugSlot, wall: wallSlot, floor: floorSlot };

  function applyReducedClass() {
    frame.classList.toggle("room-reduced", reduced());
  }
  applyReducedClass();
  reducedQuery.addEventListener?.("change", () => {
    applyReducedClass();
    syncParticles();
  });
  document.addEventListener("visibilitychange", syncParticles);

  // ---- mood / sprite ----
  function renderMood() {
    const next = tickled && state.mood === "idle" ? "happy" : state.mood;
    if (next !== shownMood) {
      shownMood = next;
      ambient.dataset.mood = next;
      flameMood.style.transform = `scale(${FLAME_SCALE[next] ?? 1})`;
      flameMood.style.opacity = String(FLAME_OPACITY[next] ?? 1);
      restartBlink();
      syncParticles();
    }
    const src = spriteSrc(blinking ? "blink" : shownMood);
    if (body.getAttribute("src") !== src) body.setAttribute("src", src);
  }

  function restartBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = null;
    blinking = false;
    if (shownMood !== "idle" && shownMood !== "focus") return;
    const schedule = () => {
      blinkTimer = setTimeout(() => {
        blinking = true;
        renderMood();
        blinkTimer = setTimeout(() => {
          blinking = false;
          renderMood();
          schedule();
        }, 130);
      }, 2500 + Math.random() * 3000);
    };
    schedule();
  }

  // ---- position + hop ----
  function positionCharacter(onChair) {
    const box = characterBox(onChair);
    character.style.left = pct(box.left);
    character.style.top = pct(box.top);
    // Bubble beside the head, on the side facing the open floor.
    const headX = box.left + CHARACTER.headTop.x * CHAR_W;
    const headY = box.top + CHARACTER.headTop.y * CHAR_H;
    const x = headX + (onChair ? -1 : 1) * CHAR_W * 0.85;
    bubbleAnchor.style.left = `clamp(80px, ${pct(x)}, calc(100% - 80px))`;
    bubbleAnchor.style.top = `max(${pct(headY - 0.08)}, 30px)`;
    bubbleAnchor.dataset.side = onChair ? "left" : "right";
  }

  let fadeOut = null; // the reduced-motion fade-out in progress
  let fadeTimer = 0;

  function move(onChair, animate) {
    const seq = ++moveSeq;
    if (!animate) {
      frame.classList.add("room-no-move");
      positionCharacter(onChair);
      void character.offsetWidth;
      frame.classList.remove("room-no-move");
      return;
    }
    if (reduced()) {
      // A plain fade out, jump, fade in. A newer move cancels the older
      // fade, so a superseded forwards-filled fade can never leave the
      // character hidden.
      frame.classList.add("room-no-move");
      clearTimeout(fadeTimer);
      fadeOut?.cancel();
      const out = character.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" });
      fadeOut = out;
      fadeTimer = setTimeout(() => {
        out.cancel();
        if (fadeOut === out) fadeOut = null;
        if (seq !== moveSeq) return;
        positionCharacter(onChair);
        character.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: "ease-out" });
        frame.classList.remove("room-no-move");
      }, 150);
      return;
    }
    positionCharacter(onChair);
    hop();
  }

  function hop() {
    if (reduced()) return;
    const up = 0.22 / 0.48;
    hopper.animate([
      { transform: "translateY(0)", easing: "cubic-bezier(0.33, 0, 0.3, 1)" },
      { transform: `translateY(${-HOP_LIFT * 100}%)`, offset: up, easing: "cubic-bezier(0.6, 0, 0.8, 0.6)" },
      { transform: "translateY(0)" },
    ], { duration: 480 });
  }

  // ---- speech ----
  function say(text) {
    if (!text) return;
    const id = ++lineSeq;
    clearTimeout(lineTimer);
    const onLeft = bubbleAnchor.dataset.side === "left";
    const bubble = h("div", { class: `room-bubble ${onLeft ? "room-bubble-tail-right" : "room-bubble-tail-left"}` },
      h("span", { class: "room-bubble-text", text }),
      h("span", { class: "room-bubble-tail", attrs: { "aria-hidden": "true" } }));
    bubbleAnchor.replaceChildren(bubble);
    const rotate = `rotate(${onLeft ? 2 : -2}deg)`;
    bubble.style.transform = rotate;
    // Reduced motion: fade only, no scale.
    bubble.animate(reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [
        { transform: `${rotate} scale(0.6)`, opacity: 0 },
        { transform: `${rotate} scale(1)`, opacity: 1 },
      ], { duration: reduced() ? 200 : 350, easing: reduced() ? "ease-out" : BOUNCY });
    lineTimer = setTimeout(() => {
      if (id !== lineSeq) return;
      bubble.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: "ease-out", fill: "forwards" });
      // A timer, not anim.finished: a hidden page never finishes animations.
      lineTimer = setTimeout(() => { if (id === lineSeq) bubbleAnchor.replaceChildren(); }, 200);
    }, 3000);
  }

  function poke(event) {
    event?.preventDefault();
    if (!state) return;
    hop();
    say(pokeLine(state.mood));
    if (state.mood !== "idle") return;
    tickled = true;
    renderMood();
    clearTimeout(tickleTimer);
    tickleTimer = setTimeout(() => {
      tickled = false;
      if (state) renderMood();
    }, 1200);
  }

  // ---- decor & drop ----
  function fadeOutAndRemove(el, duration = 300) {
    el.classList.add("room-leaving");
    el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration, easing: "ease-in-out", fill: "forwards" });
    setTimeout(() => el.remove(), duration);
  }

  function setDecor(slot, name, animate) {
    if (decorNames[slot] === name) return;
    decorNames[slot] = name;
    const el = slots[slot];
    for (const old of [...el.children]) {
      if (old.classList.contains("room-leaving")) continue;
      if (animate) fadeOutAndRemove(old); else old.remove();
    }
    if (!name) return;
    const img = h("img", { class: "room-fill", src: assetPath(name), alt: "", draggable: false });
    el.append(img);
    if (animate) img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-in-out" });
  }

  function setDrop(item, animate) {
    for (const old of [...dropSlot.children]) {
      if (old.classList.contains("room-leaving")) continue;
      if (animate) fadeOutAndRemove(old, 250); else old.remove();
    }
    if (!item) return;
    const wrap = h("div", { class: "room-fill room-drop-item" }, itemImage(item));
    dropSlot.append(wrap);
    if (!animate) return;
    if (reduced()) {
      wrap.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-in-out" });
      return;
    }
    const fall = -DROP_FALL * 100;
    wrap.animate([
      { transform: `translateY(${fall}%)`, opacity: 0, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
      { transform: "translateY(0)", opacity: 1, offset: 0.62, easing: "ease-out" },
      { transform: "translateY(-9%)", offset: 0.8, easing: "ease-in" },
      { transform: "translateY(0)" },
    ], { duration: 550 });
  }

  // ---- particles ----
  function syncParticles() {
    const want = shownMood && shownMood !== "sad" && !reduced() && !document.hidden;
    if (want && !rafId) {
      colors = null;
      rafId = requestAnimationFrame(frameTick);
    } else if (!want && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (!want) clearCanvas();
  }

  function clearCanvas() {
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }

  function frameTick(now) {
    rafId = requestAnimationFrame(frameTick);
    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!colors) {
      const cs = getComputedStyle(frame);
      colors = {
        accent: cs.getPropertyValue("--accent").trim() || "#e89e40",
        primary: cs.getPropertyValue("--primary").trim() || "#4a6ba6",
      };
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    const t = now / 1000;
    if (shownMood === "sleep") drawZs(ctx, cw, ch, t);
    else if (shownMood !== "sad") drawSparks(ctx, cw, ch, t, shownMood === "happy" ? 8 : 4);
    ctx.globalAlpha = 1;
  }

  function drawSparks(ctx, w, hgt, t, count) {
    const ox = CHARACTER.flameCenter.x * w;
    const oy = CHARACTER.flameCenter.y * hgt;
    for (let i = 0; i < count; i++) {
      const p = (t / 1.6 + i / count) % 1;
      const x = ox + Math.sin(p * 6 + i * 2.1) * w * 0.03;
      const y = oy - hgt * 0.03 - p * hgt * 0.12;
      const r = w * 0.012 * (1 - p * 0.6);
      ctx.globalAlpha = 1 - p;
      ctx.fillStyle = i % 2 === 0 ? colors.accent : colors.primary;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawZs(ctx, w, hgt, t) {
    const ox = (CHARACTER.headTop.x + 0.2) * w;
    const oy = CHARACTER.headTop.y * hgt;
    ctx.fillStyle = colors.primary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = 0; i < 3; i++) {
      const p = (t / 2.4 + i / 3) % 1;
      ctx.globalAlpha = Math.sin(p * Math.PI);
      ctx.font = `800 ${(9 + p * 9).toFixed(1)}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
      ctx.fillText("z", ox + p * w * 0.12, oy - p * hgt * 0.16);
    }
  }

  // ---- public ----
  function update({ mood = "idle", onChair = false, drop = null, decor = {} } = {}) {
    const first = state === null;
    const prev = state ?? {};
    const dropId = drop?.id ?? null;
    state = { mood, onChair: !!onChair, dropId };

    for (const slot of ["chair", "rug", "wall", "floor"]) {
      const fallback = slot === "chair" ? "room_chair" : slot === "rug" ? "room_rug" : null;
      setDecor(slot, decor?.[slot] ?? fallback, !first);
    }
    if (first || prev.onChair !== state.onChair) move(state.onChair, !first);
    if (first || prev.dropId !== dropId) setDrop(drop, !first);
    if (first || prev.mood !== mood) {
      renderMood();
      say(greetingLine(mood));
    }
  }

  return { update };
}
