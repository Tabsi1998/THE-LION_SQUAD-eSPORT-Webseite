import { render as renderRaw, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ProfileNav } from "./ProfileNav";
import { TABS } from "./constants";

const render = (ui) => renderRaw(<MemoryRouter>{ui}</MemoryRouter>);

// Ein Menü für drei Breiten (#253): jeder Reiter genau einmal im Dokument,
// der aktive als aktuelle Seite markiert.

test("jeder Reiter steht genau einmal und der aktive ist markiert", () => {
  render(<ProfileNav tab="socials" onSelect={() => {}} />);
  for (const item of TABS) {
    expect(screen.getAllByTestId(`profile-tab-${item.k}`)).toHaveLength(1);
  }
  expect(screen.getByTestId("profile-tab-socials")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("profile-tab-basic")).not.toHaveAttribute("aria-current");
});

test("ein Klick meldet den Reiter", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ProfileNav tab="basic" onSelect={onSelect} />);
  await user.click(screen.getByRole("button", { name: /Privatsphäre/ }));
  expect(onSelect).toHaveBeenCalledWith("privacy");
});

test("ein Zaehler und ein Punkt haengen am Reiter Freunde", () => {
  render(<ProfileNav tab="basic" onSelect={() => {}} badges={{ friends: { count: 6, alert: true } }} />);
  expect(screen.getByRole("button", { name: /Freunde \(6\)/ })).toBeInTheDocument();
  expect(screen.getByTestId("profile-tab-friends-alert")).toBeInTheDocument();
  expect(screen.queryByTestId("profile-tab-privacy-alert")).toBeNull();
});

// Mein Konto unter den Reitern: Strafen, Gewinne, Benachrichtigungen, Hilfe - Mitgliedschaft nur für Mitglieder.
test("die Konto-Seiten stehen unter den Reitern, Mitgliedschaft nur für Mitglieder", () => {
  render(<ProfileNav tab="basic" onSelect={() => {}} />);
  expect(screen.getByTestId("profile-link-penalties")).toHaveAttribute("href", "/my/penalties");
  expect(screen.getByTestId("profile-link-prizes")).toHaveAttribute("href", "/my/prizes");
  expect(screen.getByTestId("profile-link-help")).toHaveAttribute("href", "/contact");
  expect(screen.queryByTestId("profile-link-invoices")).toBeNull();
  expect(screen.queryByTestId("profile-link-membership")).toBeNull();
  render(<ProfileNav tab="basic" onSelect={() => {}} isClubMember />);
  expect(screen.getByTestId("profile-link-membership")).toHaveAttribute("href", "/members/membership");
});

