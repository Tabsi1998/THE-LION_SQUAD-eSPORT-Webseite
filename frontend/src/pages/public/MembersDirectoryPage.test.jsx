import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitgliederverzeichnis (#410): kein Alter mehr als „Level“, Initialen ohne Foto, Mitglieder sehen
// „Mein Eintrag“ statt „Mitglied werden“.

const apiMock = { get: vi.fn() };
const authState = { isClubMember: false };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: MembersDirectoryPage, memberInitials } = await import("./MembersDirectoryPage");

const MEMBERS = [
  { id: "p1", slug: "paula", display_name: "Paula Beispiel", gamertag: "PaulaGG", role_title: "Mitglied", games: ["F1 25"], platforms: ["PC"], age: 24, level: 24, source: "member", linked_account: { username: "paula", achievement_level: { level: 7 } } },
  { id: "p2", slug: "otto", display_name: "Otto Obmann", photo_url: "/uploads/otto.png", role_title: "Obmann", games: [], platforms: [] },
];

beforeEach(() => {
  apiMock.get.mockResolvedValue({ data: MEMBERS });
  authState.isClubMember = false;
});

test("Karten ohne Alter, Initialen ohne Foto, Account-Level bleibt", async () => {
  render(<MemoryRouter><MembersDirectoryPage /></MemoryRouter>);
  const card = await screen.findByTestId("member-card-paula");
  expect(card).toHaveTextContent("PaulaGG");
  expect(card).not.toHaveTextContent("Level 24");
  expect(card).toHaveTextContent("Account-Level 7");
  expect(screen.getByTestId("member-card-initials-paula")).toHaveTextContent("PB");
  expect(screen.queryByTestId("member-card-initials-otto")).toBeNull();
  expect(screen.getByTestId("members-join-cta")).toBeInTheDocument();
});

test("Mitglieder sehen den Weg zu ihrem eigenen Eintrag", async () => {
  authState.isClubMember = true;
  render(<MemoryRouter><MembersDirectoryPage /></MemoryRouter>);
  await screen.findByTestId("member-card-paula");
  expect(screen.getByTestId("members-own-entry")).toHaveAttribute("href", "/members/membership");
  expect(screen.queryByTestId("members-join-cta")).toBeNull();
});

test("Initialen", () => {
  expect(memberInitials({ display_name: "Paula Beispiel" })).toBe("PB");
  expect(memberInitials({ gamertag: "tabsi" })).toBe("TA");
});
