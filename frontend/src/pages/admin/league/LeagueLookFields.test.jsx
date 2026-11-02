import { render, screen } from "@testing-library/react";

// Bilder in der Liga-Verwaltung (#2230): Die Admin-Medien gehen über die Rolle, Zuständigkeiten öffnen sie nicht. Wer sie nicht hat,
// nimmt wie jedes Konto die eigenen Bilder - sonst wären Hochladen und Mediathek hier für Zuständige immer ein 403.
const auth = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ testId, endpoint, mediaScope, libraryEndpoint }) => (
    <div data-testid={testId} data-endpoint={endpoint} data-scope={mediaScope} data-library={libraryEndpoint} />
  ),
}));

const { BannerField, EmblemField, PrizeEditor } = await import("./LeagueLookFields");

function renderFields() {
  render(
    <>
      <EmblemField value="" onChange={() => {}} testId="emblem" />
      <BannerField url="" onChange={() => {}} testId="banner" />
      <PrizeEditor rows={[{ place: "1", text: "Pokal", image_url: "" }]} onChange={() => {}} />
    </>,
  );
}

test.each([
  ["Zuständig", { role: "player", areas: [], has_league_staff: true }],
  ["Freigabe Ligen", { role: "player", areas: ["leagues"] }],
  ["Moderator und zuständig", { role: "moderator", areas: ["moderation"], has_league_staff: true }],
])("%s: Banner und Gewinnbild laden eigene Bilder hoch", (_name, user) => {
  auth.user = user;
  renderFields();
  for (const testId of ["banner", "prizes-image-0"]) {
    expect(screen.getByTestId(testId)).toHaveAttribute("data-scope", "user");
    expect(screen.getByTestId(testId)).toHaveAttribute("data-library", "/media?type=images");
  }
});

test("Zuständig: Das Emblem wählt aus den eigenen Bildern", () => {
  auth.user = { role: "player", areas: [], has_league_staff: true };
  renderFields();
  expect(screen.getByTestId("emblem")).toHaveAttribute("data-library", "/media?type=images");
});

test.each(["tournament_admin", "club_admin", "superadmin"])("%s behält die Admin-Medien", (role) => {
  auth.user = { role };
  renderFields();
  for (const testId of ["emblem", "banner", "prizes-image-0"]) {
    expect(screen.getByTestId(testId)).not.toHaveAttribute("data-scope");
    expect(screen.getByTestId(testId)).not.toHaveAttribute("data-library");
  }
  expect(screen.getByTestId("emblem")).toHaveAttribute("data-endpoint", "/uploads/logo");
});
