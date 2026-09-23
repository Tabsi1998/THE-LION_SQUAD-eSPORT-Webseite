import { albumCountLabel, groupBySection, mediaType, mediaUrl, posterUrl, sizedUpload } from "./gallery";

// Galerie in der App (#236): Medienart, Adressen und Größen wie im Web.

test("Medienart und Adressen: Bild, Video, Einbettung", () => {
  expect(mediaType({ id: "a", image_url: "/api/static/uploads/a.webp" })).toBe("image");
  expect(mediaType({ id: "b", video_url: "/api/static/uploads/b.mp4" })).toBe("video");
  expect(mediaType({ id: "c", media_type: "embed", external_url: "https://youtu.be/x" })).toBe("embed");
  expect(mediaUrl({ id: "b", video_url: "/api/static/uploads/b.mp4" })).toBe("/api/static/uploads/b.mp4");
  expect(mediaUrl({ id: "c", media_type: "embed", external_url: "https://youtu.be/x" })).toBe("https://youtu.be/x");
  expect(posterUrl({ id: "b", video_url: "/b.mp4", thumbnail_url: "/api/static/uploads/b.jpg" })).toBe("/api/static/uploads/b.jpg");
  expect(posterUrl({ id: "b", video_url: "/b.mp4" })).toBe("");
});

test("nur eigene Uploads bekommen eine Breite", () => {
  expect(sizedUpload("/api/static/uploads/foto.webp", 400)).toBe("/api/static/uploads/foto.webp?w=400");
  expect(sizedUpload("/api/static/uploads/foto.webp?v=3#x", 1600)).toBe("/api/static/uploads/foto.webp?v=3&w=1600#x");
  expect(sizedUpload("https://cdn.example.test/foto.jpg", 400)).toBe("https://cdn.example.test/foto.jpg");
  expect(sizedUpload("/api/static/uploads/clip.mp4", 400)).toBe("/api/static/uploads/clip.mp4");
});

test("Abschnitte gruppieren in Albumreihenfolge, Lose zuerst", () => {
  const album = {
    id: "al", title: "LAN", photo_count: 3, video_count: 1,
    sections: [{ id: "s1", title: "Freitag" }, { id: "s2", title: "Samstag" }],
    photos: [
      { id: "p2", order_index: 2, section_id: "s1" }, { id: "p1", order_index: 1, section_id: "s1" },
      { id: "p3", order_index: 3 }, { id: "p4", order_index: 4, section_id: "weg" },
    ],
  };
  const groups = groupBySection(album);
  expect(groups.map((group) => [group.title, group.items.map((item) => item.id)])).toEqual([["", ["p3", "p4"]], ["Freitag", ["p1", "p2"]]]);
  expect(albumCountLabel(album)).toBe("3 Bilder · 1 Video");
  expect(albumCountLabel({ id: "x", title: "leer" })).toBe("leer");
  expect(groupBySection({ id: "y", title: "ohne", photos: [{ id: "p" }] })[0].items).toHaveLength(1);
});

test("eine Adresse mit Breite bekommt keine zweite", () => {
  expect(sizedUpload("/api/static/uploads/foto.webp?w=400", 800)).toBe("/api/static/uploads/foto.webp?w=400");
});
