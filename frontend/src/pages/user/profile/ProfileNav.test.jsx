import { render as renderRaw, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProfileNav } from "./ProfileNav";
import { SETTINGS_GROUPS, TABS, tabRedirect } from "./constants";

const render = (ui) => renderRaw(<MemoryRouter>{ui}</MemoryRouter>);

// Einstellungen an einem Ort (#1146): dieselben Gruppen in derselben Reihenfolge wie in der App - Darstellung,
// Benachrichtigungen, Sicherheit, Privatsphäre, Konto, Über die App. Ein Menü für drei Breiten (#253): jeder Reiter genau
// einmal im Dokument, der aktive als aktuelle Seite markiert.

test("die Gruppen stehen in der Reihenfolge der App", () => {
  // Dieselbe Liste wie mobile/src/screens/main/SettingsScreen.tsx (SETTINGS_GROUPS).
  expect(SETTINGS_GROUPS.map((group) => group.label)).toEqual(["Darstellung", "Benachrichtigungen", "Sicherheit", "Privatsphäre", "Konto", "Über die App"]);
  render(<ProfileNav tab="basic" onSelect={() => {}} />);
  expect(screen.getAllByTestId("settings-group-title").map((node) => node.textContent)).toEqual(SETTINGS_GROUPS.map((group) => group.label));
  expect(within(screen.getByTestId("settings-group-account")).getByTestId("profile-tab-basic")).toBeInTheDocument();
  expect(within(screen.getByTestId("settings-group-account")).getByTestId("settings-data")).toHaveAttribute("href", "/privacy-account");
});

test("jeder Reiter steht genau einmal und der aktive ist markiert", () => {
  render(<ProfileNav tab="socials" onSelect={() => {}} />);
  for (const item of TABS) {
    expect(screen.getAllByTestId(`profile-tab-${item.k}`)).toHaveLength(1);
  }
  expect(screen.getByTestId("profile-tab-socials")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("profile-tab-basic")).not.toHaveAttribute("aria-current");
});

test("Teams, Freunde, Erfolge, Ehrungen und Rechnungen sind keine Einstellungen - sie haben ihren Ort woanders", () => {
  render(<ProfileNav tab="basic" onSelect={() => {}} />);
  for (const gone of ["teams", "friends", "achievements", "honours", "invoices"]) expect(screen.queryByTestId(`profile-tab-${gone}`)).toBeNull();
  const params = new URLSearchParams("tab=invoices&invoice=d-501");
  expect(tabRedirect("teams", params, "lionfan")).toBe("/teams");
  expect(tabRedirect("friends", params, "lionfan")).toBe("/players");
  expect(tabRedirect("achievements", params, "lionfan")).toBe("/u/lionfan?tab=achievements");
  expect(tabRedirect("honours", params, "lionfan")).toBe("/u/lionfan?tab=honours");
  expect(tabRedirect("invoices", params, "lionfan")).toBe("/account/invoices?invoice=d-501");
  expect(tabRedirect("invoices", new URLSearchParams("invoice=../x"), "lionfan")).toBe("/account/invoices");
  expect(tabRedirect("inbox", new URLSearchParams("to=u-9"))).toBe("/messages/u-9");
  expect(tabRedirect("privacy", params)).toBeNull();
});

test("ein Klick meldet den Reiter; Abmelden steht unter Konto", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onLogout = vi.fn();
  render(<ProfileNav tab="basic" onSelect={onSelect} onLogout={onLogout} />);
  await user.click(screen.getByRole("button", { name: /Privatsphäre/ }));
  expect(onSelect).toHaveBeenCalledWith("privacy");
  await user.click(screen.getByTestId("settings-logout"));
  expect(onLogout).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("profile-tab-notifications")).toHaveTextContent("Benachrichtigungen einstellen");
});
