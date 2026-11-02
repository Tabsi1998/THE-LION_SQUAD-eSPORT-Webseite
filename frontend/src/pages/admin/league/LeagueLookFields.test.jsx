import { render, screen } from "@testing-library/react";

// Bilder in der Liga-Verwaltung (#2230): Die Admin-Medien gehen über die Rolle, Zuständigkeiten öffnen sie nicht. Wer sie nicht hat,
// nimmt wie jedes Konto die eigenen Bilder - sonst wären Hochladen und Mediathek hier für Zuständige immer ein 403.
const auth = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/tls/ImageUpload", () => ({
  ImageUpload: ({ testId, endpoint, mediaScope, libraryEndpoint, logo }) => (
    <div data-testid={testId} data-endpoint={endpoint} data-scope={mediaScope} data-library={libraryEndpoint} data-logo={String(Boolean(logo))} />
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

test.each([
  ["Zuständig", { role: "player", areas: [], has_league_staff: true }],
  ["Freigabe Ligen", { role: "player", areas: ["leagues"] }],
  ["Moderator und zuständig", { role: "moderator", areas: ["moderation"], has_league_staff: true }],
])("%s: Das Emblem nimmt eigene Bilder über den Bild-Upload, der Hinweis sagt: kein SVG", (_name, user) => {
  auth.user = user;
  renderFields();
  const emblem = screen.getByTestId("emblem");
  expect(emblem).toHaveAttribute("data-endpoint", "/uploads/image");
  expect(emblem).toHaveAttribute("data-logo", "false");
  expect(emblem).toHaveAttribute("data-scope", "user");
  expect(emblem).toHaveAttribute("data-library", "/media?type=images");
  expect(screen.getByText(/PNG, JPG oder WebP/)).toHaveTextContent("kein SVG");
});

test.each(["tournament_admin", "club_admin", "superadmin"])("%s behält die Admin-Medien", (role) => {
  auth.user = { role };
  renderFields();
  for (const testId of ["emblem", "banner", "prizes-image-0"]) {
    expect(screen.getByTestId(testId)).not.toHaveAttribute("data-scope");
    expect(screen.getByTestId(testId)).not.toHaveAttribute("data-library");
  }
  expect(screen.getByTestId("emblem")).toHaveAttribute("data-endpoint", "/uploads/logo");
  expect(screen.getByTestId("emblem")).toHaveAttribute("data-logo", "true");
  expect(screen.getByText(/am besten SVG/)).toBeInTheDocument();
});
