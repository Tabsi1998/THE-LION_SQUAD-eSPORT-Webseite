import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Konten in der Mitgliederakte (#846): je geprüftem Konto ein Schalter, nur auf Wunsch in die Akte; der Wunsch des Vereins
// führt zum Verknüpfen; ohne Fähigkeit der Grund, ohne Verbindung zur Akte nichts (das erklärt die Karte „Vereinsakte“).

const apiMock = { get: vi.fn(), put: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => detail || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const { MemberFileAccountsCard, accountLine } = await import("./MemberFileAccountsCard");

const DISCORD = { network: "discord", platform: "discord", label: "Discord", asked: "required", asked_label: "Der Verein wünscht",
  in_file: { handle: "", confirmed: false, client: "", confirmed_at: "" }, website: { linked: true, handle: "paula" }, shared: false, can_share: true };
const STEAM = { network: "steam", platform: "steam", label: "Steam", asked: "optional", asked_label: "Der Verein freut sich über",
  in_file: { handle: "", confirmed: false, client: "", confirmed_at: "" }, website: { linked: false, handle: "" }, shared: false, can_share: false };
const VIEW = { available: true, accounts: [DISCORD, STEAM], wishes: [] };

beforeEach(() => {
  vi.clearAllMocks();
});

function show() {
  return render(<MemoryRouter><MemberFileAccountsCard /></MemoryRouter>);
}

test("Zustand in Worten", () => {
  expect(accountLine(DISCORD)).toBe("Auf der Website verknüpft: paula – noch nicht in der Akte");
  expect(accountLine(STEAM)).toBe("Auf der Website nicht verknüpft");
  expect(accountLine({ ...DISCORD, shared: true, in_file: { handle: "paula", confirmed: true } })).toBe("In der Akte: paula – bestätigt durch die Website");
  expect(accountLine({ ...STEAM, in_file: { handle: "paula_steam", confirmed: false } })).toBe("In der Akte: paula_steam – vom Vorstand eingetragen");
});

test("Schalter nur für geprüfte Konten; an schickt den Wunsch und zeigt den neuen Stand", async () => {
  apiMock.get.mockResolvedValue({ data: VIEW });
  apiMock.put.mockResolvedValue({ data: { ...VIEW, accounts: [{ ...DISCORD, shared: true, in_file: { handle: "paula", confirmed: true } }, STEAM] } });
  show();
  const discord = await screen.findByTestId("membership-accounts-discord");
  expect(discord).toHaveAttribute("aria-checked", "false");
  expect(screen.getByTestId("membership-accounts-steam")).toBeDisabled();
  expect(screen.getByTestId("membership-accounts-card")).toHaveTextContent("Der Verein wünscht dieses Konto.");

  fireEvent.click(discord);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/membership/me/accounts/discord", { share: true }));
  await waitFor(() => expect(screen.getByTestId("membership-accounts-discord")).toHaveAttribute("aria-checked", "true"));
  expect(screen.getByTestId("membership-accounts-card")).toHaveTextContent("In der Akte: paula – bestätigt durch die Website");
  expect(toastMock.success).toHaveBeenCalledWith("Discord steht jetzt in deiner Mitgliederakte.");
});

test("der Wunsch des Vereins führt zum Verknüpfen im Profil", async () => {
  apiMock.get.mockResolvedValue({ data: { ...VIEW, accounts: [{ ...DISCORD, website: { linked: false, handle: "" }, can_share: false }],
    wishes: [{ network: "discord", platform: "discord", label: "Discord", asked: "required" }] } });
  show();
  const wish = await screen.findByTestId("membership-accounts-wish-discord");
  expect(wish).toHaveTextContent("Der Verein wünscht: Discord verknüpfen.");
  expect(screen.getByTestId("membership-accounts-link-discord")).toHaveAttribute("href", "/profile?tab=socials&link=discord");
});

test("ohne Fähigkeit der Grund, ohne Verbindung zur Akte nichts", async () => {
  apiMock.get.mockResolvedValue({ data: { available: false, reason: "no_capability", text: "Der Vorstand schaltet die Fähigkeit „Konten“ ein." } });
  const { unmount } = show();
  expect(await screen.findByTestId("membership-accounts-reason")).toHaveTextContent("Fähigkeit „Konten“");
  unmount();

  apiMock.get.mockResolvedValue({ data: { available: false, reason: "not_bound", text: "Erst verbinden." } });
  show();
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledTimes(2));
  expect(screen.queryByTestId("membership-accounts-card")).toBeNull();
});
