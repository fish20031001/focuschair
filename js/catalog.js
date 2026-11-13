// Static content shared by every module. Mirrors the SwiftUI app:
// Item.swift (items), Economy.swift (decor), CharacterView.swift (lines,
// art anchors). tests/run.mjs checks the parity against the Swift source.

export const CURRENCY = "火種";

export const CHARACTER = {
  name: "小惡魔",
  aspect: 0.6186,
  bodyX: 0.403,
  seatY: 0.80,
  feetY: 0.99,
  headTop: { x: 0.40, y: 0.30 },
  flameCenter: { x: 0.088, y: 0.417 },
};

export const RARITY_LABEL = { common: "普通", rare: "稀有", legendary: "傳說" };

export const GIFTS = [
  { id: "ember", name: "小火苗", emoji: "🔥", kind: "gift", rarity: "common" },
  { id: "candy", name: "糖果", emoji: "🍬", kind: "gift", rarity: "common" },
  { id: "bat", name: "小蝙蝠", emoji: "🦇", kind: "gift", rarity: "common" },
  { id: "star", name: "星星", emoji: "⭐️", kind: "gift", rarity: "common" },
  { id: "moon", name: "月亮", emoji: "🌙", kind: "gift", rarity: "common" },
  { id: "pumpkin", name: "南瓜燈", emoji: "🎃", kind: "gift", rarity: "rare" },
  { id: "crystal", name: "水晶球", emoji: "🔮", kind: "gift", rarity: "rare" },
  { id: "key", name: "古老鑰匙", emoji: "🗝️", kind: "gift", rarity: "rare" },
  { id: "contract", name: "惡魔契約", emoji: "📜", kind: "gift", rarity: "legendary" },
  { id: "crown", name: "小皇冠", emoji: "👑", kind: "gift", rarity: "legendary" },
];

export const TRASH = [
  { id: "smoke", name: "一團黑煙", emoji: "💨", kind: "trash", rarity: "common" },
  { id: "can", name: "空罐子", emoji: "🥫", kind: "trash", rarity: "common" },
  { id: "bone", name: "魚骨頭", emoji: "🦴", kind: "trash", rarity: "common" },
  { id: "peel", name: "香蕉皮", emoji: "🍌", kind: "trash", rarity: "common" },
  { id: "sock", name: "破襪子", emoji: "🧦", kind: "trash", rarity: "common" },
];

export const ITEMS = [...GIFTS, ...TRASH];

export function itemById(id) {
  return ITEMS.find((item) => item.id === id) ?? null;
}

export function itemAsset(item) {
  return `assets/item_${item.id}.png`;
}

/** Same odds as ItemCatalog.randomGift: longer sessions favour rarer gifts. */
export function randomGift(minutes, random = Math.random) {
  const legendaryChance = Math.min(0.02 + minutes / 1500, 0.10);
  const rareChance = Math.min(0.15 + minutes / 300, 0.40);
  const roll = random();
  const rarity = roll < legendaryChance ? "legendary"
    : roll < legendaryChance + rareChance ? "rare"
    : "common";
  const pool = GIFTS.filter((gift) => gift.rarity === rarity);
  return pool[Math.floor(random() * pool.length)] ?? GIFTS[0];
}

export function randomTrash(random = Math.random) {
  return TRASH[Math.floor(random() * TRASH.length)] ?? TRASH[0];
}

export const DECOR_SLOTS = [
  { id: "chair", title: "椅子", allowsNone: false },
  { id: "rug", title: "地毯", allowsNone: false },
  { id: "wall", title: "牆面裝飾", allowsNone: true },
  { id: "floor", title: "地板擺設", allowsNone: true },
];

export const DECOR = [
  { id: "decor_chair_wood", name: "木頭椅", slot: "chair", price: 0, asset: "room_chair" },
  { id: "decor_chair_armchair", name: "藍色沙發椅", slot: "chair", price: 60, asset: "decor_chair_armchair" },
  { id: "decor_chair_throne", name: "小惡魔王座", slot: "chair", price: 150, asset: "decor_chair_throne" },
  { id: "decor_rug_oval", name: "橢圓地毯", slot: "rug", price: 0, asset: "room_rug" },
  { id: "decor_rug_star", name: "星星地毯", slot: "rug", price: 40, asset: "decor_rug_star" },
  { id: "decor_rug_flame", name: "火焰地毯", slot: "rug", price: 80, asset: "decor_rug_flame" },
  { id: "decor_wall_frame", name: "火焰畫框", slot: "wall", price: 30, asset: "decor_wall_frame" },
  { id: "decor_wall_clock", name: "掛鐘", slot: "wall", price: 50, asset: "decor_wall_clock" },
  { id: "decor_wall_bats", name: "蝙蝠吊飾", slot: "wall", price: 70, asset: "decor_wall_bats" },
  { id: "decor_floor_plant", name: "盆栽", slot: "floor", price: 40, asset: "decor_floor_plant" },
  { id: "decor_floor_lamp", name: "立燈", slot: "floor", price: 60, asset: "decor_floor_lamp" },
  { id: "decor_floor_cauldron", name: "小魔藥鍋", slot: "floor", price: 120, asset: "decor_floor_cauldron" },
];

export function decorById(id) {
  return DECOR.find((decor) => decor.id === id) ?? null;
}

export function assetPath(name) {
  return `assets/${name}.png`;
}

export const SOUNDS = [
  { id: "rain", title: "雨聲" },
  { id: "fire", title: "火堆" },
  { id: "waves", title: "海浪" },
  { id: "clock", title: "時鐘" },
];

export const MODES = {
  pomodoro: { title: "番茄鐘" },
  stopwatch: { title: "正計時" },
};

export const STOPWATCH_MIN_MINUTES = 10;
export const STOPWATCH_MAX_MINUTES = 180;

export const LINES = {
  greeting: {
    idle: ["要開始了嗎？椅子我暖好了", "今天想專心做什麼？", "準備好就叫我"],
    focus: ["噓，我在旁邊盯著", "火苗幫你顧時間", "手機先放旁邊喔"],
    happy: ["做得好！這個給你", "撐完了！獎勵剛出爐"],
    sad: ["沒關係，休息一下再來", "這次先放過你，下次一起撐完"],
    sleep: ["呼…休息一下下", "眼睛閉起來五分鐘"],
  },
  poke: {
    focus: "噓，專心！",
    sleep: "Zzz…別吵…",
    other: ["嘿嘿", "好癢！", "再戳火苗就燒你喔", "要一起專心嗎？"],
  },
};

export function greetingLine(mood, random = Math.random) {
  const lines = LINES.greeting[mood] ?? [];
  return lines.length ? lines[Math.floor(random() * lines.length)] : null;
}

export function pokeLine(mood, random = Math.random) {
  if (mood === "focus") return LINES.poke.focus;
  if (mood === "sleep") return LINES.poke.sleep;
  const lines = LINES.poke.other;
  return lines[Math.floor(random() * lines.length)];
}
