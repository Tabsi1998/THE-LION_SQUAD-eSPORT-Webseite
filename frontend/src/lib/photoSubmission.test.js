import { photoCredit, pickSubmissionFiles, submissionDoneText, submissionHint } from "./photoSubmission";

// Fotos vom Event einsenden (#1186): was die Seite vor dem Senden sagt.

function file(name, type = "image/jpeg", size = 1024) {
  return { name, type, size };
}

test("nur Bilder, nicht zu groß, höchstens so viele, wie noch frei sind", () => {
  const { accepted, skipped } = pickSubmissionFiles([
    file("a.jpg"), file("b.png", "image/png"), file("c.heic", "image/heic"), file("d.jpg", "image/jpeg", 30 * 1024 * 1024), file("e.webp", "image/webp"),
  ], 2);
  expect(accepted.map((f) => f.name)).toEqual(["a.jpg", "b.png"]);
  expect(skipped).toEqual([
    { name: "c.heic", reason: "nur PNG, JPG oder WebP" },
    { name: "d.jpg", reason: "größer als 25 MB" },
    { name: "e.webp", reason: "höchstens 2 Fotos gehen noch" },
  ]);
  expect(pickSubmissionFiles([file("a.jpg")], 0).accepted).toEqual([]);
});

test("der Hinweis nennt Frist, Rest und Wartende", () => {
  expect(submissionHint({ open: true, until: "2026-10-22", remaining: 18, pending: 2, max: 20 })).toBe("Bis Do., 22. Oktober · noch 18 Fotos · 2 warten auf Freigabe");
  expect(submissionHint({ open: true, until: "2026-10-22", remaining: 0, pending: 1, max: 20 })).toBe("Bis Do., 22. Oktober · alle 20 Fotos geschickt · 1 wartet auf Freigabe");
  expect(submissionHint({ open: false, until: "2026-10-22" })).toBe("Einsenden war bis Do., 22. Oktober möglich.");
  expect(submissionHint(null)).toBe("");
});

test("nach dem Senden ein Satz, Name am Foto", () => {
  expect(submissionDoneText(3, 0)).toBe("Danke! 3 Fotos warten auf Freigabe durch den Vorstand.");
  expect(submissionDoneText(1, 1)).toBe("Danke! Dein Foto wartet auf Freigabe durch den Vorstand. Ein Foto ging nicht durch.");
  expect(submissionDoneText(0, 2)).toBe("Das hat nicht geklappt – bitte noch einmal versuchen.");
  expect(photoCredit({ credit: "Anna" })).toBe("Foto: Anna");
  expect(photoCredit({})).toBe("");
});
