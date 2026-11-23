import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Verteilen (#1359) mit echter Mail-Vorschau (#2119 ML5): „Mail ansehen“ zeigt Betreff und Mail, wie sie hinausginge.

const apiMock = { get: vi.fn(), post: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { DistributeBox } = await import("./DistributeBox");

const BOX = { kind: "news", source_id: "n1", title: "Herbst-LAN", state: "ready", recipients: 3, can_send: true, can_resend: true, announcement: "Keine eigene Meldung." };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.get.mockResolvedValue({ data: BOX });
  apiMock.post.mockImplementation(async (url) => {
    if (url === "/settings/newsletter/preview") return { data: { ...BOX, mail: { subject: "Neue Vereinsnews: Herbst-LAN", html: "<p>Hallo Max</p>" } } };
    return { data: {} };
  });
});

test("Mail ansehen zeigt Betreff und Mail, ohne zu senden; nochmal klicken schließt", async () => {
  const user = userEvent.setup();
  render(<DistributeBox kind="news" itemId="n1" />);
  await user.click(await screen.findByTestId("distribute-preview-toggle"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/settings/newsletter/preview", { kind: "news", id: "n1" }));
  expect(await screen.findByTestId("distribute-preview-subject")).toHaveTextContent("Neue Vereinsnews: Herbst-LAN");
  expect(screen.getByTestId("distribute-preview-frame")).toHaveAttribute("srcdoc", "<p>Hallo Max</p>");
  expect(screen.getByTestId("distribute-preview-frame")).toHaveAttribute("sandbox", "");
  expect(apiMock.post).not.toHaveBeenCalledWith("/settings/newsletter/send", expect.anything());
  await user.click(screen.getByTestId("distribute-preview-toggle"));
  expect(screen.queryByTestId("distribute-preview")).toBeNull();
});

test("„Nur intern“ hat keine Mail und darum keine Vorschau", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BOX, state: "internal", recipients: 0 } });
  render(<DistributeBox kind="news" itemId="n1" />);
  expect(await screen.findByTestId("distribute-newsletter-line")).toHaveTextContent("Nur intern");
  expect(screen.queryByTestId("distribute-preview-toggle")).toBeNull();
});

test("„Nur App“ (#1532): kein Newsletter, kein Senden, keine Vorschau - auch vor dem ersten Speichern", async () => {
  const { rerender } = render(<DistributeBox kind="news" itemId="n1" appOnly />);
  expect(await screen.findByTestId("distribute-newsletter-line")).toHaveTextContent("Kein Newsletter – „Nur App“ geht nicht per Mail hinaus.");
  expect(screen.queryByTestId("distribute-send")).toBeNull();
  expect(screen.queryByTestId("distribute-preview-toggle")).toBeNull();
  rerender(<DistributeBox kind="news" visibility="public" appOnly />);
  expect(await screen.findByTestId("distribute-audience-line")).toHaveTextContent("Kein Newsletter – „Nur App“ geht nicht per Mail hinaus.");
  expect(apiMock.get).not.toHaveBeenCalledWith("/settings/newsletter/audience", expect.anything());
});
