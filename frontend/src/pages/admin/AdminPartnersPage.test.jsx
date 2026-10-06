import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Partner (#435): „Neuer Partner“ öffnet ein Seitenblatt statt eines Fensters; Speichern legt an,
// schließt das Blatt und lädt die Liste neu. Seit #469 gehen Kanäle und Tools mit; leere Tool-Zeilen nicht.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "Fehler", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ImageUpload", () => ({ ImageUpload: () => <div data-testid="image-upload" /> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { default: AdminPartnersPage, formFromPartner, partnerPayload } = await import("./AdminPartnersPage");

beforeEach(() => {
  apiMock.get.mockImplementation(async (url) => {
    // Sponsoren und Partner aus Dolibarr (#405): der Block über der Liste fragt den Schalter ab.
    if (url === "/admin/dolibarr/sponsors") return { data: { from_dolibarr: false, connected: false } };
    return { data: [{ id: "p1", slug: "gamers-heaven", name: "Gamers Heaven", kind: "Messe", is_active: true, about: null, tools: [{ id: "t1", title: "Hallenplan", url: "https://gh.test/plan", description: null }] }] };
  });
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { id: "p2" } });
});

test("Neuer Partner öffnet das Seitenblatt, Speichern legt an und schließt es", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  expect(await screen.findByText("Gamers Heaven")).toBeInTheDocument();
  expect(screen.queryByTestId("partner-sheet")).toBeNull();

  fireEvent.click(screen.getByTestId("partner-new"));
  expect(screen.getByRole("dialog", { name: "Neuer Partner" })).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("partner-name"), { target: { value: "IT-Tabelander" } });
  fireEvent.change(screen.getByTestId("partner-kind"), { target: { value: "Community" } });
  fireEvent.submit(screen.getByTestId("partner-sheet"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/partners", expect.objectContaining({ name: "IT-Tabelander", kind: "Community", is_active: true })));
  await waitFor(() => expect(screen.queryByTestId("partner-sheet")).toBeNull());
  expect(apiMock.get.mock.calls.filter(([url]) => url === "/partners/admin")).toHaveLength(2);
});

test("Bearbeiten öffnet das Blatt mit den Werten des Partners, Tools inklusive", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  await screen.findByText("Gamers Heaven");
  expect(screen.getByTestId("partner-page-p1")).toHaveAttribute("href", "/partners/gamers-heaven");
  fireEvent.click(screen.getAllByRole("button").find((button) => button.querySelector("svg.lucide-pencil")));
  expect(screen.getByRole("dialog", { name: "Partner bearbeiten" })).toBeInTheDocument();
  expect(screen.getByTestId("partner-name")).toHaveValue("Gamers Heaven");
  expect(screen.getByTestId("partner-slug")).toHaveValue("gamers-heaven");
  expect(screen.getByTestId("partner-about")).toHaveValue("");
  expect(screen.getByTestId("partner-tool-title-0")).toHaveValue("Hallenplan");
  fireEvent.click(screen.getByTestId("partner-sheet-cancel"));
  expect(screen.queryByTestId("partner-sheet")).toBeNull();
});

test("Partnerseite (#469): Kanäle und ein Tool gehen mit, eine leere Tool-Zeile nicht", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  await screen.findByText("Gamers Heaven");
  fireEvent.click(screen.getByTestId("partner-new"));
  fireEvent.change(screen.getByTestId("partner-name"), { target: { value: "PineApps TFT" } });
  fireEvent.change(screen.getByTestId("partner-twitch-channel"), { target: { value: "pineapps" } });
  fireEvent.change(screen.getByTestId("partner-discord-guild"), { target: { value: "123456789012345678" } });
  fireEvent.click(screen.getByTestId("partner-tool-add"));
  fireEvent.change(screen.getByTestId("partner-tool-title-0"), { target: { value: "TFT Dashboard" } });
  fireEvent.change(screen.getByTestId("partner-tool-url-0"), { target: { value: "https://tft.pineapps.at" } });
  fireEvent.click(screen.getByTestId("partner-tool-embed-0"));
  fireEvent.click(screen.getByTestId("partner-tool-add"));
  expect(screen.getByTestId("partner-tool-1")).toBeInTheDocument();
  fireEvent.submit(screen.getByTestId("partner-sheet"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/partners", expect.objectContaining({
    name: "PineApps TFT", twitch_channel: "pineapps", discord_guild_id: "123456789012345678",
    tools: [expect.objectContaining({ title: "TFT Dashboard", url: "https://tft.pineapps.at", embed: true })],
  })));
});

test("Socials (#967): „+ Social“ holt eine Zeile mit Plattform und Adresse, Entfernen nimmt sie weg; gespeichert wird die Liste, die alten Felder leer", async () => {
  render(<MemoryRouter><AdminPartnersPage /></MemoryRouter>);
  await screen.findByText("Gamers Heaven");
  fireEvent.click(screen.getByTestId("partner-new"));
  fireEvent.change(screen.getByTestId("partner-name"), { target: { value: "Gamers Heaven" } });
  expect(screen.queryByTestId("partner-youtube")).toBeNull();
  expect(screen.getByTestId("partner-socials")).toHaveTextContent("Noch keine Socials");
  fireEvent.click(screen.getByTestId("partner-social-add"));
  expect(screen.getByTestId("partner-social-platform-0")).toHaveValue("facebook");
  fireEvent.change(screen.getByTestId("partner-social-url-0"), { target: { value: "https://facebook.com/gamersheaven" } });
  fireEvent.click(screen.getByTestId("partner-social-add"));
  fireEvent.change(screen.getByTestId("partner-social-platform-1"), { target: { value: "linkedin" } });
  fireEvent.change(screen.getByTestId("partner-social-url-1"), { target: { value: "https://linkedin.com/company/gh" } });
  fireEvent.click(screen.getByTestId("partner-social-add"));
  expect(screen.queryByTestId("partner-social-label-2")).toBeNull();
  fireEvent.change(screen.getByTestId("partner-social-platform-2"), { target: { value: "custom" } });
  expect(screen.getByTestId("partner-social-label-2")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("partner-social-remove-2"));
  expect(screen.queryByTestId("partner-social-2")).toBeNull();
  const options = [...screen.getByTestId("partner-social-platform-0").querySelectorAll("option")].map((option) => option.value);
  expect(options).toEqual(expect.arrayContaining(["facebook", "instagram", "tiktok", "youtube", "x", "linkedin", "threads", "bluesky", "email", "custom"]));
  expect(options).not.toContain("website");
  fireEvent.submit(screen.getByTestId("partner-sheet"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/partners", expect.objectContaining({
    name: "Gamers Heaven",
    social_links: [{ platform: "facebook", url: "https://facebook.com/gamersheaven", label: "" }, { platform: "linkedin", url: "https://linkedin.com/company/gh", label: "" }],
    youtube_url: "", x_url: "", instagram_url: "", tiktok_url: "",
  })));
});

test("formFromPartner holt die vier alten Felder in die Liste; partnerPayload lässt leere Zeilen weg", () => {
  const form = formFromPartner({ id: "p", name: "X", youtube_url: "https://youtube.com/@x", instagram_url: null, social_links: [{ platform: "facebook", url: "https://facebook.com/x", label: null }] });
  expect(form.social_links).toEqual([{ platform: "facebook", url: "https://facebook.com/x", label: "" }, { platform: "youtube", url: "https://youtube.com/@x", label: "" }]);
  expect(form.youtube_url).toBe("");
  const payload = partnerPayload({ ...form, social_links: [...form.social_links, { platform: "tiktok", url: "  ", label: "" }] });
  expect(payload.social_links).toHaveLength(2);
  expect(payload.youtube_url).toBe("");
});

test("formFromPartner macht aus null leere Felder; partnerPayload lässt leere Tool-Zeilen weg", () => {
  const form = formFromPartner({ id: "p", name: "X", about: null, twitch_channel: null, tools: [{ id: "t", title: "A", url: "https://a.test", description: null }] });
  expect(form.about).toBe("");
  expect(form.twitch_channel).toBe("");
  expect(form.tools[0]).toEqual({ id: "t", title: "A", url: "https://a.test", description: "", image_url: "", embed: false });
  expect(partnerPayload({ ...form, tools: [...form.tools, { id: "", title: "", url: "", description: "", image_url: "", embed: false }] }).tools).toHaveLength(1);
});
