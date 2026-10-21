import { loadMemberPlacements } from "./memberPlacements";

// Vereinsplatzierungen im Profil (#1945): die App findet das Vereinsprofil zum Konto - im eigenen Profil über den
// eigenen Verzeichniseintrag, bei anderen über das öffentlich verknüpfte Konto -, lädt dessen Referenzen und die Spuren
// für Saison und Liga-Weg. Ohne Vereinsprofil, bei privatem Konto oder altem Server: null - der Reiter bleibt wie heute.

const mockGet = jest.fn();
jest.mock("./api", () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

const profile = { id: "mp-1", slug: "mira-stahl", references: [{ id: "r1", title: "Liga" }] };
const lineages = [{ lineage: { slug: "desbl", title: "DeSBL" }, seasons: [{ season: "S1", reference_ids: ["r1"] }] }];

function answer(map: Record<string, unknown>) {
  return (path: string) => (path in map ? Promise.resolve({ data: map[path] }) : Promise.reject(new Error(`404 ${path}`)));
}

beforeEach(() => mockGet.mockReset());

test("eigenes Profil: über den eigenen Verzeichniseintrag", async () => {
  mockGet.mockImplementation(answer({
    "/membership/me/directory": { listed: true, slug: "mira-stahl" },
    "/membership/profiles/mira-stahl": profile,
    "/reference-series/public/lineages": { items: lineages },
  }));
  expect(await loadMemberPlacements({ own: true, username: "mira" })).toEqual({ profileId: "mp-1", references: profile.references, lineages });
});

test("anderes Profil: über das öffentlich verknüpfte Konto, Groß und klein egal", async () => {
  mockGet.mockImplementation(answer({
    "/membership/profiles": [{ id: "x", slug: "andere", linked_account: { username: "jemand" } }, { id: "mp-1", slug: "mira-stahl", linked_account: { username: "Mira" } }],
    "/membership/profiles/mira-stahl": profile,
    "/reference-series/public/lineages": { items: lineages },
  }));
  expect(await loadMemberPlacements({ own: false, username: "mira" })).toMatchObject({ profileId: "mp-1", lineages });
});

test("ohne Spuren (alter Server) trotzdem die Referenzen", async () => {
  mockGet.mockImplementation(answer({
    "/membership/me/directory": { slug: "mira-stahl" },
    "/membership/profiles/mira-stahl": profile,
  }));
  expect(await loadMemberPlacements({ own: true, username: "mira" })).toEqual({ profileId: "mp-1", references: profile.references, lineages: [] });
});

test("ohne Vereinsprofil, ohne verknüpftes Konto oder bei Fehlern: null", async () => {
  mockGet.mockImplementation(answer({ "/membership/me/directory": { listed: false, slug: null } }));
  expect(await loadMemberPlacements({ own: true, username: "mira" })).toBeNull();
  mockGet.mockImplementation(answer({ "/membership/profiles": [{ id: "x", slug: "andere", linked_account: null }] }));
  expect(await loadMemberPlacements({ own: false, username: "mira" })).toBeNull();
  mockGet.mockImplementation(answer({}));
  expect(await loadMemberPlacements({ own: false, username: "mira" })).toBeNull();
  expect(await loadMemberPlacements({ own: false, username: "" })).toBeNull();
});
