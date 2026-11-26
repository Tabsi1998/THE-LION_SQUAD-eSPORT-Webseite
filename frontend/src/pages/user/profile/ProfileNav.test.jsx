import { render as renderRaw, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProfileNav } from "./ProfileNav";
import { SETTINGS_GROUPS, TABS, settingsGroupOf } from "./constants";

const render = (ui) => renderRaw(<MemoryRouter>{ui}</MemoryRouter>);

// Die Einstellungen in „Mein Bereich“ (#2059): vier Gruppen mit ihren Reitern - dieselben Namen wie in der Seitenleiste.
// Je Gruppe steht nur ihre Reiterreihe da; eine Gruppe mit einem Reiter braucht keine.

test("vier Gruppen in der Reihenfolge von „Mein Bereich“, jeder Reiter genau einmal", () => {
  expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(["Profil", "Benachrichtigungen", "Konto & Sicherheit", "Datenschutz"]);
  expect(SETTINGS_GROUPS.map((group) => group.tabs.map((tab) => tab.k))).toEqual([
    ["basic", "gaming", "socials"], ["notifications"], ["security", "appearance", "calendar", "about"], ["privacy"],
  ]);
  expect(new Set(TABS.map((tab) => tab.k)).size).toBe(TABS.length);
  expect(settingsGroupOf("calendar")).toBe("konto");
  expect(settingsGroupOf("privacy")).toBe("datenschutz");
  expect(settingsGroupOf("teams")).toBeNull();
});

test("Teams, Freunde, Erfolge, Ehrungen und Rechnungen sind keine Einstellungen - sie haben ihren Ort woanders", () => {
  for (const gone of ["teams", "friends", "achievements", "honours", "invoices"]) expect(TABS.some((tab) => tab.k === gone)).toBe(false);
});

test("die Reiter einer Gruppe: der aktive als aktuelle Seite, ein Klick meldet den Reiter", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const profil = SETTINGS_GROUPS.find((group) => group.key === "profil").tabs;
  render(<ProfileNav tabs={profil} tab="socials" onSelect={onSelect} label="Profil" />);
  expect(screen.getByRole("navigation", { name: "Profil" })).toBeInTheDocument();
  expect(screen.getByTestId("profile-tab-socials")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("profile-tab-basic")).not.toHaveAttribute("aria-current");
  expect(screen.queryByTestId("profile-tab-security")).toBeNull();
  await user.click(screen.getByRole("button", { name: /Gaming & Spiel-IDs/ }));
  expect(onSelect).toHaveBeenCalledWith("gaming");
  // Ein Klick auf den aktiven Reiter ändert nichts.
  await user.click(screen.getByTestId("profile-tab-socials"));
  expect(onSelect).toHaveBeenCalledTimes(1);
});

test("eine Gruppe mit nur einem Reiter zeigt keine Reiterreihe", () => {
  const notifications = SETTINGS_GROUPS.find((group) => group.key === "benachrichtigungen").tabs;
  render(<ProfileNav tabs={notifications} tab="notifications" onSelect={() => {}} />);
  expect(screen.queryByTestId("mein-bereich-reiter")).toBeNull();
});
