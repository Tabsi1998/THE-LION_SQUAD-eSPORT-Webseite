import { searchStickers, stickerSrc } from "./stickers";

const packs = [
  {
    id: "eigen",
    name: "Lion Squad",
    stickers: [{ id: "s-1", name: "Brüllender Löwe", keywords: ["brüll", "gg"] }],
  },
  {
    id: "fluent-esports",
    name: "eSports & Party",
    stickers: [
      { id: "fluent-trophy", name: "Pokal", keywords: ["sieg", "champion"] },
      { id: "fluent-lion", name: "Löwe", keywords: ["lion squad"] },
    ],
  },
];

describe("Sticker suchen", () => {
  test("findet nach Name und Suchwort, über alle Pakete", () => {
    expect(searchStickers(packs, "pokal").map((s) => s.id)).toEqual(["fluent-trophy"]);
    expect(searchStickers(packs, "SIEG").map((s) => s.id)).toEqual(["fluent-trophy"]);
    expect(searchStickers(packs, "gg").map((s) => s.id)).toEqual(["s-1"]);
  });

  test("Umlaute muss man nicht tippen", () => {
    expect(searchStickers(packs, "lowe").map((s) => s.id)).toEqual(["s-1", "fluent-lion"]);
    expect(searchStickers(packs, "brull").map((s) => s.id)).toEqual(["s-1"]);
  });

  test("ohne Eingabe kein Treffer, und derselbe Sticker kommt nur einmal", () => {
    expect(searchStickers(packs, "  ")).toEqual([]);
    const doubled = [...packs, { id: "kopie", stickers: [packs[1].stickers[0]] }];
    expect(searchStickers(doubled, "pokal")).toHaveLength(1);
    expect(searchStickers(null, "pokal")).toEqual([]);
  });

  test("Bildadressen gehen an den Server, der auch die API ausliefert", () => {
    expect(stickerSrc("/api/stickers/files/fluent/lion.png").endsWith("/api/stickers/files/fluent/lion.png")).toBe(true);
    expect(stickerSrc("")).toBe("");
  });
});
