// 火種 rewards and the decor shop. Pure functions over plain data, matching
// Economy.swift. A shop value is { purchased: [decorId], equipped: { slot: decorId } }.
import { DECOR, DECOR_SLOTS, decorById, itemById } from "./catalog.js";

const BONUS = { common: 0, rare: 3, legendary: 8 };

/** max(1, minutes / 5) plus a bonus for rarer gifts. */
export function reward(minutes, rarity) {
  return Math.max(1, Math.floor(minutes / 5)) + (BONUS[rarity] ?? 0);
}

/** Derived from the record alone; failed sessions earn nothing. */
export function rewardForRecord(record) {
  if (!record.success) return 0;
  return reward(record.minutes, itemById(record.itemID)?.rarity ?? "common");
}

export function earned(records) {
  return records.reduce((sum, record) => sum + rewardForRecord(record), 0);
}

export function spent(shop) {
  return shop.purchased.reduce((sum, id) => sum + (decorById(id)?.price ?? 0), 0);
}

export function balance(records, shop) {
  return earned(records) - spent(shop);
}

export function owns(shop, decor) {
  return decor.price === 0 || shop.purchased.includes(decor.id);
}

export function defaultDecor(slot) {
  return DECOR.find((decor) => decor.slot === slot && decor.price === 0) ?? null;
}

/** The equipped item if still valid and owned, otherwise the slot default. */
export function current(shop, slot) {
  const decor = decorById(shop.equipped[slot]);
  if (decor && decor.slot === slot && owns(shop, decor)) return decor;
  return defaultDecor(slot);
}

export function isEquipped(shop, decor) {
  return current(shop, decor.slot)?.id === decor.id;
}

/** Returns the new shop, or null when already owned or unaffordable. */
export function purchase(shop, decor, available) {
  if (owns(shop, decor) || available < decor.price) return null;
  return {
    purchased: [...shop.purchased, decor.id],
    equipped: { ...shop.equipped, [decor.slot]: decor.id },
  };
}

export function equip(shop, decor) {
  if (!owns(shop, decor)) return shop;
  return { ...shop, equipped: { ...shop.equipped, [decor.slot]: decor.id } };
}

/** Puts away wall or floor decor; chairs and rugs always have one. */
export function clear(shop, slotId) {
  const slot = DECOR_SLOTS.find((s) => s.id === slotId);
  if (!slot?.allowsNone) return shop;
  const equipped = { ...shop.equipped };
  delete equipped[slotId];
  return { ...shop, equipped };
}

/** Asset names for the room; wall and floor may be null. */
export function roomDecor(shop) {
  return {
    chair: current(shop, "chair")?.asset ?? "room_chair",
    rug: current(shop, "rug")?.asset ?? "room_rug",
    wall: current(shop, "wall")?.asset ?? null,
    floor: current(shop, "floor")?.asset ?? null,
  };
}
