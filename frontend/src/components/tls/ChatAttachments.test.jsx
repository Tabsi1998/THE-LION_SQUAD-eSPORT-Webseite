import { fireEvent, render, screen } from "@testing-library/react";

// Bildprüfung (#415) im Chat: ein entferntes Bild ist ein Platzhalter; ein noch ungeprüftes lädt nur
// beim Absender - bekommt der Empfänger vom Server 404, steht „wird geprüft“ statt eines kaputten Bildes.

vi.mock("@/lib/api", () => ({ api: { post: vi.fn() }, API_BASE: "" }));
vi.mock("@/lib/videoPoster", () => ({ captureVideoPoster: vi.fn() }));

const { ChatMessageAttachments } = await import("./ChatAttachments");

test("entfernt → Platzhalter; ungeprüft → Bild, bei 404 der Hinweis „wird geprüft“", () => {
  render(<ChatMessageAttachments attachments={[
    { id: "a1", kind: "image", url: "/api/chat-attachments/a1", scan_state: "blocked" },
    { id: "a2", kind: "image", url: "/api/chat-attachments/a2", scan_state: "pending", width: 800, height: 600 },
    { id: "a3", kind: "image", url: "/api/chat-attachments/a3", scan_state: "review" },
    { id: "a4", kind: "image", url: "/api/chat-attachments/a4" },
  ]} />);
  expect(screen.getByTestId("chat-attachment-blocked-a1")).toHaveTextContent("Bild entfernt – Moderation");
  const images = screen.getAllByRole("img");
  expect(images).toHaveLength(3);
  fireEvent.error(images[0]);
  expect(screen.getByTestId("chat-attachment-pending-a2")).toHaveTextContent("Bild wird geprüft");
  fireEvent.error(screen.getAllByRole("img")[0]);
  expect(screen.getByTestId("chat-attachment-review-a3")).toHaveTextContent("von der Moderation geprüft");
  // Ein freigegebenes Bild bleibt ein Bild - auch wenn es einmal nicht lädt.
  fireEvent.error(screen.getAllByRole("img")[0]);
  expect(screen.getAllByRole("img")).toHaveLength(1);
  expect(screen.getAllByRole("img")[0]).toHaveAttribute("src", "/api/chat-attachments/a4?w=400");
});
