import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// „Ergebnis teilen“ (#1194): am PC Bild herunterladen und Link kopieren, im Handy-Browser ein Knopf fürs
// Teilen-Menü mit dem Bild; privates Profil sagt, wo man es ändert; ohne Teilnahme bleibt es leer.

const apiMock = { get: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (v) => v || "" }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { ResultShareButton } = await import("./ResultShareButton");

const OPTIONS = {
  shareable: true, path: "/tournaments/fc26-cup/ergebnis/neonfalke",
  image_paths: { story: "/api/share/result/fc26-cup/neonfalke/story.png", wide: "/api/share/result/fc26-cup/neonfalke/wide.png" },
  headline: "Platz 2 im FC 26 Herbst-Cup", share_text: "Ich habe Platz 2 im FC 26 Herbst-Cup geholt – bei THE LION SQUAD.",
};

function renderButton(props) {
  return render(<MemoryRouter><ResultShareButton tournamentId="t1" {...props} /></MemoryRouter>);
}

beforeEach(() => {
  apiMock.get.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  vi.unstubAllGlobals();
});

describe("ResultShareButton", () => {
  it("am PC: Bild herunterladen und Link kopieren, dazu die Vorschau-Seite - auch wenn Windows teilen könnte", async () => {
    apiMock.get.mockResolvedValue({ data: OPTIONS });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    renderButton({ nav: { clipboard: { writeText }, share: vi.fn(), canShare: () => true } });
    const download = await screen.findByTestId("result-share-download");
    expect(apiMock.get).toHaveBeenCalledWith("/share/result-options/t1");
    expect(download).toHaveAttribute("href", OPTIONS.image_paths.story);
    expect(download).toHaveAttribute("download", "ergebnis-fc26-cup-neonfalke-story.png");
    expect(screen.queryByTestId("result-share-share")).toBeNull();
    expect(screen.getByTestId("result-share-page")).toHaveAttribute("href", OPTIONS.path);
    fireEvent.click(screen.getByTestId("result-share-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${OPTIONS.path}`));
    expect(toastMock.success).toHaveBeenCalledWith("Link kopiert.");
  });

  it("im Handy-Browser: ein Knopf, der das vorab geladene Bild samt Link teilt", async () => {
    apiMock.get.mockResolvedValue({ data: OPTIONS });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["png"], { type: "image/png" })) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const share = vi.fn().mockResolvedValue(undefined);
    renderButton({ nav: { share, canShare: () => true } });
    const button = await screen.findByTestId("result-share-share");
    expect(button).toHaveTextContent("Ergebnis teilen");
    expect(screen.queryByTestId("result-share-download")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(OPTIONS.image_paths.story, { credentials: "include" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    fireEvent.click(button);
    await waitFor(() => expect(share).toHaveBeenCalled());
    const shared = share.mock.calls[0][0];
    expect(shared.files[0].name).toBe("ergebnis-fc26-cup-neonfalke-story.png");
    expect(shared.text).toBe(`${OPTIONS.share_text} ${window.location.origin}${OPTIONS.path}`);
  });

  it("privates Profil: ein Satz mit dem Weg zur Privatsphäre; ohne Teilnahme nichts", async () => {
    apiMock.get.mockResolvedValue({ data: { shareable: false, reason: "private_profile", text: "Dein Profil ist privat." } });
    const { unmount } = renderButton({ nav: {} });
    const hint = await screen.findByTestId("result-share-hint");
    expect(hint).toHaveTextContent("Dein Profil ist privat. Zur Privatsphäre");
    expect(screen.getByRole("link", { name: "Zur Privatsphäre" })).toHaveAttribute("href", "/profile?tab=privacy");
    unmount();

    apiMock.get.mockResolvedValue({ data: { shareable: false, reason: "not_participant", text: "Du hast nicht mitgespielt." } });
    const { container } = renderButton({ nav: {} });
    await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
    expect(container).toBeEmptyDOMElement();
  });

  it("mit fertigen Daten fragt er den Server nicht und kann die Vorschau weglassen", () => {
    renderButton({ tournamentId: undefined, options: OPTIONS, showPage: false, nav: {} });
    expect(apiMock.get).not.toHaveBeenCalled();
    expect(screen.getByTestId("result-share-download")).toBeInTheDocument();
    expect(screen.queryByTestId("result-share-page")).toBeNull();
  });
});
