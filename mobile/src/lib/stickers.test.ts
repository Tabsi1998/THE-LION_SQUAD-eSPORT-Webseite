import { searchStickers, stickerSource, type StickerPack } from "./stickers";

const packs: StickerPack[] = [
  {
    id: "eigen",
    name: "Lion Squad",
    stickers: [{ id: "s-1", name: "Brüllender Löwe", keywords: ["brüll", "gg"], url: "/api/static/uploads/roar.png" }],
  },
  {
    id: "fluent-esports",
    name: "eSports & Party",
    stickers: [
      { id: "fluent-trophy", name: "Pokal", keywords: ["sieg"], url: "/api/stickers/files/fluent/trophy.png" },
      { id: "fluent-lion", name: "Löwe", keywords: ["lion squad"], url: "/api/stickers/files/fluent/lion.png" },
    ],
  },
];

describe("Sticker suchen", () => {
  test("nach Name und Suchwort, über alle Pakete", () => {
    expect(searchStickers(packs, "Pokal").map((sticker) => sticker.id)).toEqual(["fluent-trophy"]);
    expect(searchStickers(packs, "gg").map((sticker) => sticker.id)).toEqual(["s-1"]);
  });

  test("Umlaute muss man am Handy nicht suchen", () => {
    expect(searchStickers(packs, "lowe").map((sticker) => sticker.id)).toEqual(["s-1", "fluent-lion"]);
  });

  test("ohne Eingabe kein Treffer, derselbe Sticker nur einmal", () => {
    expect(searchStickers(packs, " ")).toEqual([]);
    expect(searchStickers([...packs, { id: "kopie", name: "Kopie", stickers: [packs[1].stickers[0]] }], "pokal")).toHaveLength(1);
    expect(searchStickers(null, "pokal")).toEqual([]);
  });
});

describe("Stickerbilder", () => {
  test("kommen vom API-Server und ohne Anmeldung", () => {
    const source = stickerSource("/api/stickers/files/fluent/lion.png");
    expect(source?.uri).toMatch(/^https?:\/\/.+\/api\/stickers\/files\/fluent\/lion\.png$/);
    expect(source).not.toHaveProperty("headers");
    expect(stickerSource(null)).toBeNull();
  });
});
