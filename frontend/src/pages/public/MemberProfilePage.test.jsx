import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Vereinsplatzierungen im Mitgliederprofil (#859): dieselben Bausteine wie die Referenzen-Seite (#409) - Medaillen
// mit Zahlen, Podest/Einzel/Team, je Teilnahme die Karte mit der Platzierung dieser Person und nur ihrem Eintrag.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));

const { default: MemberProfilePage, memberEntry } = await import("./MemberProfilePage");

const TEAM_CUP = {
  id: "r1", title: "Winter Cup", display_title: "Winter Cup", game: { id: "g1", name: "Rocket League" }, best_placement: 1, medal: "gold",
  entries: [
    { id: "e1", kind: "team", team_name: "LION A", placement: 1, medal: "gold", member_profile_ids: ["p9"], lineup: ["Gast"] },
    { id: "e2", kind: "team", team_name: "LION B", placement: 2, medal: "silver", member_profile_ids: ["p1"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }] },
  ],
};
const SOLO_CUP = {
  id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", game: { id: "g2", name: "EA FC" }, best_placement: 3, medal: "bronze",
  entries: [{ id: "e3", kind: "solo", placement: 3, medal: "bronze", member_profile_ids: ["p1"], lineup_members: [{ profile_id: "p1", display_name: "Anni" }] }],
};
const PROFILE = {
  id: "p1", slug: "anni", display_name: "Anni", gamertag: "Anni",
  references: [{ ...TEAM_CUP, member_entry: TEAM_CUP.entries[1] }, { ...SOLO_CUP, member_entry: SOLO_CUP.entries[0] }],
  reference_stats: { total: 2, gold: 0, silver: 1, bronze: 1, podiums: 2, solo: 1, team: 1 },
};

function renderProfile() {
  return render(
    <MemoryRouter initialEntries={["/members/anni"]}>
      <Routes><Route path="/members/:slug" element={<MemberProfilePage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Medaillen mit Zahlen, Podest/Einzel/Team und je Karte die eigene Platzierung", async () => {
  apiMock.get.mockResolvedValue({ data: PROFILE });
  renderProfile();
  const section = await screen.findByTestId("member-references");
  expect(apiMock.get).toHaveBeenCalledWith("/membership/profiles/anni");
  expect(within(section).getByText("Vereinsplatzierungen")).toBeInTheDocument();
  // „Alle Referenzen“ filtert die Referenzen-Seite auf diese Person.
  expect(screen.getByTestId("member-references-all")).toHaveAttribute("href", "/references?member=p1&name=Anni");
  expect(screen.getByTestId("member-reference-stat-gold")).toHaveTextContent("0");
  expect(screen.getByTestId("member-reference-stat-silver")).toHaveTextContent("1");
  expect(screen.getByTestId("member-reference-stat-bronze")).toHaveTextContent("1");
  expect(screen.getByTestId("member-reference-stat-podiums")).toHaveTextContent("2 Podestplätze");
  expect(screen.getByTestId("member-reference-stat-solo")).toHaveTextContent("1 als Einzelstarter");
  expect(screen.getByTestId("member-reference-stat-team")).toHaveTextContent("1 im Team");

  // Im Team: Platz 2 des eigenen Teams - nicht der Sieg des anderen Vereinsteams, und nur der eigene Eintrag.
  const team = screen.getByTestId("member-reference-r1");
  expect(within(team).getByTestId("placement-badge")).toHaveAttribute("data-medal", "silver");
  expect(within(team).getByTestId("reference-entry-e2")).toHaveTextContent("LION B");
  expect(within(team).queryByTestId("reference-entry-e1")).toBeNull();
  expect(within(team).getByRole("link", { name: "Winter Cup" })).toHaveAttribute("href", "/references/r1");
  const solo = screen.getByTestId("member-reference-r2");
  expect(within(solo).getByTestId("placement-badge")).toHaveAttribute("data-medal", "bronze");
  expect(within(solo).getByTestId("reference-entry-e3")).toHaveTextContent("Einzel");
});

test("ohne Teilnahmen kein leerer Block; ohne eigenen Eintrag zählt der erste", async () => {
  apiMock.get.mockResolvedValue({ data: { ...PROFILE, references: [], reference_stats: {} } });
  renderProfile();
  expect(await screen.findByText("Anni", { selector: "h1" })).toBeInTheDocument();
  expect(screen.queryByTestId("member-references")).toBeNull();

  expect(memberEntry({ ...TEAM_CUP, member_entry: TEAM_CUP.entries[1] }).id).toBe("e2");
  expect(memberEntry(TEAM_CUP).id).toBe("e1");
});
