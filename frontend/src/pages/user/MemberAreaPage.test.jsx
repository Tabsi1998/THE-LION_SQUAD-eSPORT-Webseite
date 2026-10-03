import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Mitgliederbereich (#626): die Discord-Server des Vereins mit dem eigenen Status - „Du bist dabei“ nur mit
// verknüpftem Discord, sonst Einladung und Hinweis; ohne Server kein Block.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ API: "/api", api: apiMock, formatMemberSince: () => "2020", resolveMediaUrl: (value) => value || "" }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1", display_name: "Paula" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));

const { default: MemberAreaPage } = await import("./MemberAreaPage");

const SERVERS = [
  { available: true, guild_id: "1", name: "LION", member_count: 120, invite_url: "https://discord.gg/lion", main: true },
  { available: true, guild_id: "2", name: "Rocket League", member_count: 40, invite_url: "https://discord.gg/rocket", main: false },
];

function mockApi(discord) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/membership/discord-servers") {
      if (discord instanceof Error) throw discord;
      return { data: discord };
    }
    if (url === "/settings/public") return { data: { discord_invite_url: "https://discord.gg/lion" } };
    if (url === "/membership/me") return { data: { membership: {} } };
    return { data: url.startsWith("/membership/") ? {} : [] };
  });
}

test("alle Server mit eigenem Status", async () => {
  mockApi({ linked: true, servers: [{ ...SERVERS[0], member: true }, { ...SERVERS[1], member: false }] });
  render(<MemoryRouter><MemberAreaPage /></MemoryRouter>);
  expect(await screen.findByTestId("member-area-discord-servers")).toHaveTextContent("Discord-Server");
  expect(screen.getByTestId("member-area-discord-server-1-joined")).toHaveTextContent("Du bist dabei");
  expect(screen.getByTestId("member-area-discord-server-2-join")).toHaveAttribute("href", "https://discord.gg/rocket");
  expect(screen.queryByTestId("member-area-discord-server-link-hint")).toBeNull();
});

test("ohne Verknüpfung: Einladungen und der Weg zum Verknüpfen", async () => {
  mockApi({ linked: false, servers: SERVERS.map((server) => ({ ...server, member: null })) });
  render(<MemoryRouter><MemberAreaPage /></MemoryRouter>);
  expect(await screen.findByTestId("member-area-discord-server-link-hint")).toHaveTextContent("Discord verknüpfen");
  expect(screen.getByTestId("member-area-discord-server-1-join")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-server-1-joined")).toBeNull();
});

test("keine Server oder Fehler: kein Block", async () => {
  mockApi({ linked: true, servers: [] });
  const { unmount } = render(<MemoryRouter><MemberAreaPage /></MemoryRouter>);
  expect(await screen.findByTestId("member-area-discord")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-servers")).toBeNull();
  unmount();
  mockApi(new Error("offline"));
  render(<MemoryRouter><MemberAreaPage /></MemoryRouter>);
  expect(await screen.findByTestId("member-area-discord")).toBeInTheDocument();
  expect(screen.queryByTestId("member-area-discord-servers")).toBeNull();
});
