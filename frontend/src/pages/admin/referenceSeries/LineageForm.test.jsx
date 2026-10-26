import { fireEvent, render, screen } from "@testing-library/react";

// Spur anlegen (#2024): die Platzhalter folgen der gewählten Art - eine neue Turnierserie zeigt keine Rennliga-Vorgabe.

vi.mock("@/lib/api", () => ({ api: { post: vi.fn(), patch: vi.fn() }, formatApiError: (detail) => detail || "Fehler" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("./SeriesLogoField", () => ({ SeriesLogoField: () => null }));
vi.mock("./SeriesPartnersField", () => ({ SeriesPartnersField: () => null }));

const { LineageForm } = await import("./LineageForm");
const { RACING_PROFILE, SERIES_PROFILE } = await import("@/lib/seriesKinds.fixture");

test("die Platzhalter wechseln mit der Art", () => {
  render(<LineageForm lineage={{}} profiles={{ racing: RACING_PROFILE, series: SERIES_PROFILE }} onClose={() => {}} onSaved={() => {}} />);
  expect(screen.getByTestId("lineage-title")).toHaveAttribute("placeholder", "Lion Racing F1");
  fireEvent.change(screen.getByTestId("lineage-kind"), { target: { value: "series" } });
  expect(screen.getByTestId("lineage-title")).toHaveAttribute("placeholder", "TFT Masters");
  expect(screen.getByTestId("lineage-label")).toHaveAttribute("placeholder", "TFT");
});
