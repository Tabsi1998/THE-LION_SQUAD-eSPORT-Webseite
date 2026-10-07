import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Vorstands-Porträts aus einem Guss (#1332): freigestellt auf dem Vereins-Hintergrund, sonst Duoton, ohne Foto der leere
// Hintergrund; echter Name groß, Spielername klein; ohne freigegebenen Namen kein Name; lange Rollen als Etikett und Wort.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { BoardAvatar, BoardPortrait, VacancyPortrait, personNames, softBreaks, splitRole } = await import("./BoardPortrait");

const LEO = { display_name: "Leo Beispiel", gamertag: "LeoLöwe", real_name: "Leo Beispiel", photo_url: "/api/static/uploads/leo.png", photo_cutout: true, profile_url: "/members/leoloewe" };
const MIRA = { display_name: "Mira Muster", gamertag: "MiraMaus", photo_url: "/api/static/uploads/mira.png", photo_cutout: false, profile_url: "/members/miramaus" };

const plain = (node) => node.textContent.replace(/\u200B/g, "");

function show(node) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

test("freigestellt: Vereins-Hintergrund; Rolle, echter Name groß, Spielername klein", () => {
  show(<BoardPortrait person={LEO} title="Obmann" testId="p" />);
  expect(screen.getByTestId("p-image")).toHaveAttribute("data-look", "club");
  expect(screen.getByTestId("p")).toHaveAttribute("href", "/members/leoloewe");
  expect(screen.getByTestId("p")).toHaveAttribute("data-season-anchor", "card");
  expect(screen.getByTestId("p")).toHaveTextContent("ObmannLeo Beispiel LeoLöwe");
});

test("Foto mit Hintergrund: Duoton; ohne echten Namen steht der Spielername groß", () => {
  show(<BoardPortrait person={{ ...MIRA, display_name: "MiraMaus" }} title="Kassierin" testId="p" />);
  expect(screen.getByTestId("p-image")).toHaveAttribute("data-look", "duotone");
  expect(screen.getByTestId("p")).toHaveTextContent("KassierinMiraMaus");
  expect(personNames({ gamertag: "MiraMaus", display_name: "MiraMaus" })).toEqual({ primary: "MiraMaus", secondary: "" });
  expect(personNames(MIRA)).toEqual({ primary: "Mira Muster", secondary: "MiraMaus" });
});

test("ohne Foto der leere Hintergrund; Name nicht freigegeben: kein Name, nur die Rolle", () => {
  show(<BoardPortrait person={null} title="Kassier:in" withheld testId="p" />);
  expect(screen.getByTestId("p-image")).toHaveAttribute("data-look", "empty");
  expect(plain(screen.getByTestId("p"))).toBe("Kassier:inName nicht freigegeben");
  expect(screen.getByTestId("p").tagName).toBe("DIV");
});

test("lange Rollen: Etikett und Wort statt „…“", () => {
  expect(splitRole("Stellvertretung Obmann")).toEqual({ label: "Stellvertretung", word: "Obmann" });
  expect(splitRole("Obmann-Stellvertreterin")).toEqual({ label: "Stellvertretung", word: "Obmann" });
  expect(splitRole("Kassierin")).toEqual({ label: "Kassierin", word: "" });
  show(<BoardPortrait person={MIRA} title="Kassierin" label="Stellvertretung" size="sm" testId="p" />);
  expect(screen.getByTestId("p")).toHaveTextContent("StellvertretungKassierin");
  expect(screen.getByTestId("p").textContent).not.toContain("…");
});

test("offene Funktion als Einladung: „Wir suchen …“, Satz zum Aufwand, „Interesse melden“ mit Thema", () => {
  show(<VacancyPortrait title="Obmann/Obfrau" label="Stellvertretung" text="Einmal im Monat Sitzung." testId="v" />);
  expect(plain(screen.getByTestId("v"))).toBe("Wir suchenStellvertretung Obmann/ObfrauEinmal im Monat Sitzung.Interesse melden");
  expect(softBreaks("Jugendreferent:in")).toBe("Jugendreferent:\u200Bin");
  const href = screen.getByTestId("v-contact").getAttribute("href");
  expect(href).toBe(`/contact?topic=volunteer&subject=${encodeURIComponent("Interesse: Stellvertretung Obmann/Obfrau")}`);
  expect(screen.getByTestId("v-contact")).toHaveClass("tls-btn", "tls-btn--secondary");
});

test("klein und rund für Ansprechpartner", () => {
  show(<BoardAvatar contact={{ id: "c1", title: "Stellvertretung Kassier", name: "Sina Muster", gamertag: "SternNebel", avatar: "/s.png", cutout: true, profileUrl: "/members/sina" }} testId="a" />);
  expect(screen.getByTestId("a")).toHaveAttribute("href", "/members/sina");
  expect(screen.getByTestId("a")).toHaveTextContent("StellvertretungKassierSina Muster SternNebel");
  expect(screen.getByTestId("a").querySelector(".tls-portrait--round")).not.toBeNull();
});
