import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Einladung zum Verein (#507): Hinweis mit Weg zum Antrag, ausblendbar, nicht auf der Antragsseite.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));

const { InvitationBanner } = await import("./InvitationBanner");

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

test("zeigt die Einladung mit Notiz und Weg zum Antrag; Ausblenden gilt für die Sitzung", async () => {
  apiMock.get.mockResolvedValue({ data: { open: true, id: "inv-1", note: "Wir freuen uns auf dich!", created_at: "2026-09-25T10:00:00+00:00", expires_at: "2026-10-25T10:00:00+00:00" } });
  const user = userEvent.setup();
  render(<MemoryRouter><InvitationBanner pathname="/dashboard" /></MemoryRouter>);
  expect(await screen.findByTestId("invitation-banner")).toBeInTheDocument();
  expect(screen.getByTestId("invitation-note")).toHaveTextContent("Wir freuen uns auf dich!");
  expect(screen.getByTestId("invitation-apply")).toHaveAttribute("href", "/membership/apply");
  await user.click(screen.getByTestId("invitation-dismiss"));
  expect(screen.queryByTestId("invitation-banner")).toBeNull();
  expect(window.sessionStorage.getItem("tls_invitation_dismissed")).toBe("1");
});

test("ohne Einladung und auf der Antragsseite bleibt der Hinweis weg", async () => {
  apiMock.get.mockResolvedValue({ data: { open: false } });
  render(<MemoryRouter><InvitationBanner pathname="/dashboard" /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/membership/invitation/me"));
  expect(screen.queryByTestId("invitation-banner")).toBeNull();
  apiMock.get.mockResolvedValue({ data: { open: true, id: "inv-1", note: "" } });
  render(<MemoryRouter><InvitationBanner pathname="/membership/apply" /></MemoryRouter>);
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("invitation-banner")).toBeNull();
});
