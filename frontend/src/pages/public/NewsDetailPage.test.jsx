import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// News-Detail am PC breit: Artikel links, Seitenleiste rechts mit Angaben, Teilen, Verknüpftem und
// weiteren News (ohne den eigenen Beitrag); eine Überschrift, die den Titel wiederholt, fällt weg.

const apiMock = { get: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: NewsDetailPage, stripLeadingTitle, readingMinutes } = await import("./NewsDetailPage");

const POST = {
  id: "n1", slug: "mario-kart-abgesagt", title: "Mario Kart 8 Deluxe Championship 2026 abgesagt", category: "events", pinned: true,
  published_at: "2026-08-25T10:00:00Z", author_name: "Tabsi98", excerpt: "Die Championship muss leider abgesagt werden.",
  banner_url: "/api/static/uploads/mk8.webp",
  content: "# Mario Kart 8 Deluxe Championship 2026 abgesagt\n\nLeider müssen wir euch heute mitteilen, dass das Turnier nicht stattfinden kann.\n\n## Zu wenige Anmeldungen\n\nText.",
  content_embeds: [], mentioned_users: [],
  linked_events: [{ id: "e1", name: "Frühjahrsmesse 2027", slug: "fruehjahrsmesse-2027", start_date: "2027-03-20" }],
};
const LIST = [
  { id: "n1", slug: "mario-kart-abgesagt", title: POST.title, published_at: POST.published_at },
  { id: "n2", slug: "smash-anmeldung", title: "Anmeldung für das Smash-Turnier ist geöffnet", published_at: "2026-08-20T10:00:00Z", banner_url: "/api/static/uploads/smash.png" },
  { id: "n3", slug: "platz-3", title: "Platz 3 in der Racing League", published_at: "2026-08-10T10:00:00Z" },
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/news/mario-kart-abgesagt"]}>
      <Routes><Route path="/news/:slug" element={<NewsDetailPage />} /></Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/news/mario-kart-abgesagt") return { data: POST };
    if (url.startsWith("/news?")) return { data: LIST };
    throw new Error(`unbekannt: ${url}`);
  });
  toastMock.success.mockReset();
});

test("Artikel und Seitenleiste: Titel einmal, Angaben, Verknüpftes, weitere News ohne den eigenen Beitrag", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Mario Kart 8 Deluxe Championship 2026 abgesagt");
  const article = screen.getByTestId("news-article");
  // Die erste Überschrift im Text wiederholt den Titel - sie steht nicht ein zweites Mal.
  expect(article.querySelectorAll("h1")).toHaveLength(1);
  expect(article).toHaveTextContent("Zu wenige Anmeldungen");
  expect(screen.getByTestId("news-meta")).toHaveTextContent("Von Tabsi98");
  expect(screen.getByTestId("news-meta")).toHaveTextContent("1 Min. Lesezeit");
  expect(screen.getByTestId("news-linked")).toHaveTextContent("Frühjahrsmesse 2027");
  const more = screen.getByTestId("news-more");
  expect(more).toHaveTextContent("Anmeldung für das Smash-Turnier");
  expect(more).toHaveTextContent("Platz 3 in der Racing League");
  expect(screen.queryByTestId("news-more-mario-kart-abgesagt")).toBeNull();
  expect(screen.getByTestId("news-share-whatsapp").getAttribute("href")).toContain(encodeURIComponent("/news/mario-kart-abgesagt"));

  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  fireEvent.click(screen.getByTestId("news-share-copy"));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/news/mario-kart-abgesagt`));
  expect(toastMock.success).toHaveBeenCalledWith("Link kopiert.");
});

test("stripLeadingTitle nimmt nur eine Überschrift weg, die den Titel wiederholt", () => {
  expect(stripLeadingTitle("# Mario Kart abgesagt\n\nText", "Mario Kart abgesagt")).toBe("Text");
  expect(stripLeadingTitle("<h1>Mario Kart <em>abgesagt</em></h1><p>Text</p>", "Mario Kart abgesagt")).toBe("<p>Text</p>");
  expect(stripLeadingTitle("# Etwas anderes\n\nText", "Mario Kart abgesagt")).toBe("# Etwas anderes\n\nText");
  expect(stripLeadingTitle("Text ohne Überschrift", "Mario Kart abgesagt")).toBe("Text ohne Überschrift");
  expect(readingMinutes("wort ".repeat(450))).toBe(2);
});
