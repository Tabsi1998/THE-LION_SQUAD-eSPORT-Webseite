import React from "react";
import { Text } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { useFaqZugang } from "./useFaqZugang";

// Zugang der FAQ beim Kontowechsel (#2449): Was Konto A sehen durfte, ist nach dem Wechsel sofort weg - schon im ersten
// Bild, nicht erst nach der neuen Antwort - und eine verspätete Antwort für A zählt nicht. Erfundene Daten.

type Offen = { resolve: (data: unknown) => void; reject: (error: unknown) => void };
const mockOffen: Offen[] = [];
const mockGet = jest.fn((_url: string) => new Promise((resolve, reject) => {
  mockOffen.push({ resolve: (data) => resolve({ data }), reject });
}));
jest.mock("../lib/api", () => ({ api: { get: (url: string) => mockGet(url) } }));
const mockAuth: { user: Record<string, unknown> | null } = { user: null };
jest.mock("../auth/AuthContext", () => ({ useAuth: () => mockAuth }));

const HELFER = {
  id: "helferdienst-eintragen", frage: "Wie trage ich mich ein?", antwort: "Tippe auf Ich helfe.",
  bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied",
};
const ALLES_ZU = { angemeldet: false, mitglied: false, helfer: false, turnierleitung: false, turnierleitung_verwaltung: false };
const MITGLIED = { darf: { ...ALLES_ZU, angemeldet: true, mitglied: true }, fragen: [HELFER] };
const GAST = { darf: ALLES_ZU, fragen: [] };

const bilder: string[] = [];

function Probe() {
  const zugang = useFaqZugang();
  const bild = `${zugang.darf.mitglied ? "mitglied" : "ohne"}|${zugang.fragen.map((frage) => frage.id).join(",")}`;
  bilder.push(bild);
  return <Text testID="zugang">{bild}</Text>;
}

async function antworte(index: number, data: unknown) {
  await act(async () => {
    mockOffen[index].resolve(data);
  });
}

beforeEach(() => {
  mockOffen.length = 0;
  bilder.length = 0;
  mockGet.mockClear();
  mockAuth.user = { id: "konto-a" };
});

test("Wechsel von Mitglied A zu Gast oder Konto B: kein Bild mehr mit dem Zugang von A, und /faq wird neu gefragt", async () => {
  const view = await render(<Probe />);
  await antworte(0, MITGLIED);
  expect(screen.getByTestId("zugang")).toHaveTextContent("mitglied|helferdienst-eintragen");

  bilder.length = 0;
  mockAuth.user = null;
  await view.rerender(<Probe />);
  // Schon das erste Bild nach dem Wechsel - die neue Antwort steht noch aus.
  expect(bilder[0]).toBe("ohne|");
  expect(mockGet).toHaveBeenCalledTimes(2);
  await antworte(1, GAST);
  expect(screen.getByTestId("zugang")).toHaveTextContent("ohne|");

  mockAuth.user = { id: "konto-b" };
  await view.rerender(<Probe />);
  expect(mockGet).toHaveBeenCalledTimes(3);
  await antworte(2, GAST);
  expect(bilder.every((bild) => bild === "ohne|")).toBe(true);
});

test("eine verspätete Antwort für A nach dem Wechsel zu B wird verworfen - der Stand von B bleibt", async () => {
  const view = await render(<Probe />);
  mockAuth.user = { id: "konto-b" };
  await view.rerender(<Probe />);
  expect(mockGet).toHaveBeenCalledTimes(2);
  // B ist Helfer und bekommt eine eigene Frage; die Antwort für A kommt erst danach.
  await antworte(1, { darf: { ...ALLES_ZU, angemeldet: true, helfer: true }, fragen: [{ ...HELFER, id: "mein-dienst", sichtbar_fuer: "helfer" }] });
  expect(screen.getByTestId("zugang")).toHaveTextContent("ohne|mein-dienst");
  await antworte(0, MITGLIED);
  expect(screen.getByTestId("zugang")).toHaveTextContent("ohne|mein-dienst");
  expect(bilder).not.toContain("mitglied|helferdienst-eintragen");
});

test("ein Fehler beim neuen Konto zeigt nur das Öffentliche", async () => {
  const view = await render(<Probe />);
  await antworte(0, MITGLIED);
  mockAuth.user = { id: "konto-b" };
  await view.rerender(<Probe />);
  await act(async () => {
    mockOffen[1].reject(new Error("offline"));
  });
  expect(screen.getByTestId("zugang")).toHaveTextContent("ohne|");
});
