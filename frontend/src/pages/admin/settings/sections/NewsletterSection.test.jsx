import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// E-Mail → Newsletter (#1359): nur noch der Verlauf - in Worten, ohne Rohwerte wie „published“ oder „public“, ohne Empfänger.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));

const { NewsletterSection } = await import("./NewsletterSection");

test("der Verlauf nennt Art, Titel, Zeit, Zahl und Sichtbarkeit in Worten", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [
    { kind: "news", id: "n-1", title: "Herbst-LAN: Plan steht", sent_at: "2026-10-05T16:02:00+00:00", sent_count: 211, visibility: "public", sent_by: null },
    { kind: "event", id: "ev-1", title: "Vereinsabend", sent_at: "2026-10-01T16:00:00+00:00", sent_count: 1, visibility: "members", sent_by: "Rita Redaktion" },
  ] } });
  render(<MemoryRouter><NewsletterSection /></MemoryRouter>);
  const news = await screen.findByTestId("newsletter-history-n-1");
  expect(news).toHaveTextContent("News");
  expect(news).toHaveTextContent("an 211 Personen");
  expect(news).toHaveTextContent("Öffentlich · beim Veröffentlichen");
  const event = screen.getByTestId("newsletter-history-ev-1");
  expect(event).toHaveTextContent("an 1 Person");
  expect(event).toHaveTextContent("Nur Mitglieder · von Hand: Rita Redaktion");
  expect(screen.getByTestId("newsletter-history")).not.toHaveTextContent(/published|public\b|members\b/);
  expect(screen.getByTestId("newsletter-intro")).toHaveTextContent("Kasten „Verteilen“");
  expect(screen.queryByTestId("newsletter-send")).toBeNull();
});
