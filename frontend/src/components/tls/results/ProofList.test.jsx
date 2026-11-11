import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

// Nachweis-Liste (#2360): Bilder und Video-Links zu einem Bezug - zeigen, hinzufügen, entfernen. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));

const { ProofList } = await import("./ProofList");

const IMAGE = { id: "b1", type: "image", kind: "protest", ref_id: "v1", side: "reg-a", own: true, own_side: true, can_remove: true,
  url: "/api/matches/m1/proof-photos/b1", width: 800, height: 600, scan_state: "pending" };
const VIDEO = { id: "l1", type: "link", kind: "protest", ref_id: "v1", side: "reg-b", own: false, own_side: false, can_remove: false,
  link: "https://video.example/watch?v=abc" };
const FROM_LEAD = { id: "l2", type: "link", kind: "protest", ref_id: "v1", side: null, own: false, own_side: false, can_remove: false,
  link: "https://clips.example/" };

function answer(items = [IMAGE, VIDEO], extra = {}) {
  return { data: { items, open: true, can_add: true, limit: 10, link_max_length: 500, ...extra } };
}

async function show(props = {}) {
  await act(async () => { render(<ProofList matchId="m1" kind="protest" refId="v1" {...props} />); });
}

function formFields(call) {
  return Object.fromEntries(call[1].entries());
}

beforeEach(() => {
  apiMock.get.mockReset().mockResolvedValue(answer());
  apiMock.post.mockReset().mockResolvedValue({ data: {} });
  apiMock.delete.mockReset().mockResolvedValue({ data: { ok: true } });
});

test("zeigt Bilder und Links des Bezugs - ein Video ist nur ein Link in einem neuen Tab, nie eingebettet", async () => {
  await show({ sideLabels: { "reg-b": "Falken" } });
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "protest", ref_id: "v1" } });
  expect(screen.getByAltText("Nachweis als Bild")).toHaveAttribute("src", "/api/matches/m1/proof-photos/b1?w=400");
  const link = screen.getByTestId("proof-list-link-l1");
  expect(link).toHaveAttribute("href", "https://video.example/watch?v=abc");
  expect(link).toHaveAttribute("target", "_blank");
  expect(link.getAttribute("rel")).toEqual(expect.stringContaining("noopener"));
  expect(link.getAttribute("rel")).toEqual(expect.stringContaining("nofollow"));
  expect(link).toHaveTextContent("video.example/watch?v=abc");
  expect(document.querySelector("iframe, video, embed, object")).toBeNull();
  // Wer es war: die eigene Seite, der Name der anderen Seite - und was noch in der Bildprüfung ist.
  expect(screen.getByTestId("proof-list-item-b1")).toHaveTextContent("Eigene Seite · wird noch geprüft");
  expect(screen.getByTestId("proof-list-item-l1")).toHaveTextContent("Falken");
  expect(screen.getByTestId("proof-list-hint")).toHaveTextContent("Regelwerk § 10.6");
  expect(screen.getByTestId("proof-list-hint")).toHaveTextContent("Ingame-Uhr");
  expect(screen.getByTestId("proof-list-audience")).toHaveTextContent("die beiden Seiten dieses Spiels und die Leitung");
});

test("ohne Namen heißt es „Gegenseite“, ein Nachweis ohne Seite kommt von der Leitung", async () => {
  apiMock.get.mockResolvedValue(answer([VIDEO, FROM_LEAD]));
  await show();
  expect(screen.getByTestId("proof-list-item-l1")).toHaveTextContent("Gegenseite");
  expect(screen.getByTestId("proof-list-item-l2")).toHaveTextContent("Leitung");
  expect(screen.getByTestId("proof-list-link-l2")).toHaveTextContent("clips.example");
});

test("Link hinzufügen: nur https, dann mit Bezug an den Server und die Liste lädt neu", async () => {
  await show();
  fireEvent.click(screen.getByTestId("proof-list-link-add"));
  expect(screen.getByTestId("proof-list-error")).toHaveTextContent("Bitte einen Link angeben.");
  fireEvent.change(screen.getByTestId("proof-list-link-input"), { target: { value: "http://video.example/clip" } });
  fireEvent.click(screen.getByTestId("proof-list-link-add"));
  expect(screen.getByTestId("proof-list-error")).toHaveTextContent("Nur Links mit https:// sind erlaubt.");
  expect(apiMock.post).not.toHaveBeenCalled();

  apiMock.get.mockResolvedValue(answer([IMAGE, VIDEO, { ...VIDEO, id: "l3", own: true, own_side: true, side: "reg-a", can_remove: true }]));
  fireEvent.change(screen.getByTestId("proof-list-link-input"), { target: { value: " https://video.example/clip " } });
  await act(async () => { fireEvent.click(screen.getByTestId("proof-list-link-add")); });
  expect(apiMock.post.mock.calls[0][0]).toBe("/matches/m1/proofs");
  expect(formFields(apiMock.post.mock.calls[0])).toEqual({ kind: "protest", ref_id: "v1", link: "https://video.example/clip" });
  await waitFor(() => expect(screen.getByTestId("proof-list-item-l3")).toBeInTheDocument());
  expect(screen.getByTestId("proof-list-link-input")).toHaveValue("");
  expect(screen.queryByTestId("proof-list-error")).toBeNull();
});

test("Bild hinzufügen: die Datei geht mit dem Bezug an den Server, eine Absage steht da", async () => {
  const changed = vi.fn();
  await show({ onChanged: changed });
  const file = new File(["bild"], "runde-3.jpg", { type: "image/jpeg" });
  await act(async () => { fireEvent.change(screen.getByTestId("proof-list-input"), { target: { files: [file] } }); });
  const fields = formFields(apiMock.post.mock.calls[0]);
  expect(fields.kind).toBe("protest");
  expect(fields.ref_id).toBe("v1");
  expect(fields.file.name).toBe("runde-3.jpg");
  expect(changed).toHaveBeenCalledTimes(1);

  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Mehr als 10 Nachweise je Seite gehen hier nicht." } } });
  await act(async () => { fireEvent.change(screen.getByTestId("proof-list-input"), { target: { files: [file] } }); });
  expect(screen.getByTestId("proof-list-error")).toHaveTextContent("Mehr als 10 Nachweise je Seite gehen hier nicht.");
  expect(changed).toHaveBeenCalledTimes(1);
});

test("Entfernen: nur beim eigenen Nachweis, erst nach der Rückfrage", async () => {
  await show();
  expect(screen.queryByTestId("proof-list-remove-l1")).toBeNull();
  const button = screen.getByTestId("proof-list-remove-b1");
  fireEvent.click(button);
  expect(apiMock.delete).not.toHaveBeenCalled();
  expect(button).toHaveTextContent("Wirklich entfernen?");
  apiMock.get.mockResolvedValue(answer([VIDEO]));
  await act(async () => { fireEvent.click(button); });
  expect(apiMock.delete).toHaveBeenCalledWith("/matches/m1/proofs/b1");
  await waitFor(() => expect(screen.queryByTestId("proof-list-item-b1")).toBeNull());
});

test("abgeschlossen oder ohne Recht: nur lesen - und bei MOSS steht, wer es sieht", async () => {
  apiMock.get.mockResolvedValue(answer([{ ...IMAGE, can_remove: false, scan_state: "safe" }], { open: false, can_add: false }));
  await show({ kind: "moss" });
  expect(apiMock.get).toHaveBeenCalledWith("/matches/m1/proofs", { params: { kind: "moss", ref_id: "v1" } });
  expect(screen.queryByTestId("proof-list-add")).toBeNull();
  expect(screen.queryByTestId("proof-list-remove-b1")).toBeNull();
  expect(screen.getByTestId("proof-list-closed")).toHaveTextContent("Abgeschlossen");
  expect(screen.getByTestId("proof-list-audience")).toHaveTextContent("nur du, Captain und Vertreter deiner Seite und die Leitung – nie die Gegenseite");
});

test("leer und Ladefehler: ein Satz statt einer leeren Fläche", async () => {
  apiMock.get.mockResolvedValue(answer([]));
  await show();
  expect(screen.getByTestId("proof-list-empty")).toHaveTextContent("Noch keine Nachweise.");
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  await show({ testId: "zweite" });
  expect(screen.getByTestId("zweite-load-error")).toHaveTextContent("ließen sich nicht laden");
  expect(screen.queryByTestId("zweite-add")).toBeNull();
});
