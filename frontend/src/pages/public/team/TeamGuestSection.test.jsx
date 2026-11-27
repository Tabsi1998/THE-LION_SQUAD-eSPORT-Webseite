import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TeamGuestSection, guestChanges, guestForm, guestPayload, guestStatusLine } from "./TeamGuestSection";

// Gastteam im Bearbeiten-Blatt (#1665, Nr. 286): Die Teamleitung gibt Verein oder Schule an und gibt einen Schulnamen frei - das
// Kennzeichen setzt die Liga-Leitung. Die Felder gehören zum Formular des Blatts (gespeichert mit „Speichern“, TeamsPage.test). Erfundene Namen.

function Sheet({ info = null, onValue = () => {} }) {
  const [value, setValue] = useState(guestForm(info));
  return <TeamGuestSection info={info} value={value} onChange={(next) => { setValue(next); onValue(next); }} />;
}

test("Schule mit Name und Freigabe: die Felder kommen nacheinander, ohne eigenen Knopf", () => {
  const seen = [];
  render(<Sheet onValue={(value) => seen.push(value)} />);
  expect(screen.queryByTestId("team-guest-name")).toBeNull();
  expect(screen.queryByTestId("team-guest-save")).toBeNull();
  fireEvent.change(screen.getByTestId("team-guest-kind"), { target: { value: "school" } });
  fireEvent.change(screen.getByTestId("team-guest-name"), { target: { value: "  Probeschule Nord " } });
  expect(screen.getByTestId("team-guest-school-public")).not.toBeChecked();
  fireEvent.click(screen.getByTestId("team-guest-school-public"));
  expect(guestPayload(seen.at(-1))).toEqual({ kind: "school", name: "Probeschule Nord", school_name_public: true });
});

test("Verein: keine Freigabe nötig; bestätigt zeigt die Plakette, wie sie in den Ligen steht", () => {
  const info = { kind: "club", name: "SV Probedorf", confirmed: true, pending: false, badge: { label: "Gast", org: "SV Probedorf" } };
  render(<Sheet info={info} />);
  expect(screen.queryByTestId("team-guest-school-public")).toBeNull();
  expect(screen.getByTestId("team-guest-preview")).toHaveTextContent("SV Probedorf");
});

test("guestChanges: nur eine echte Änderung zählt - eine Freigabe ohne Schule nicht", () => {
  const info = { kind: "club", name: "SV Probedorf" };
  expect(guestChanges(guestForm(info), info)).toBe(false);
  expect(guestChanges({ ...guestForm(info), school_name_public: true }, info)).toBe(false);
  expect(guestChanges({ ...guestForm(info), name: "SV Probedorf Nord" }, info)).toBe(true);
  expect(guestChanges({ kind: "", name: "egal", school_name_public: false }, null)).toBe(false);
});

test("guestStatusLine: nichts angegeben, offen, bestätigt, geändert", () => {
  expect(guestStatusLine(null)).toBe("");
  expect(guestStatusLine({ kind: "club" })).toContain("Wartet auf die Liga-Leitung");
  expect(guestStatusLine({ confirmed: true })).toContain("bestätigt");
  expect(guestStatusLine({ confirmed: true, pending: true })).toContain("nur „Gast“");
});
