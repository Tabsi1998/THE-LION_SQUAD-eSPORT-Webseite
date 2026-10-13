import { accessTokenExpired, isNetworkError, isSessionRejected, tokenExpiry, tokenLifetime } from "./session";

// Sitzung beim Start (#942): Ablauf aus dem Token lesen, Netzfehler von abgelehnter Sitzung unterscheiden.

function jwt(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `eyJhbGciOiJIUzI1NiJ9.${body}.unterschrift`;
}

test("Ablauf aus dem Token; ohne lesbaren Ablauf gilt es als abgelaufen", () => {
  const now = 1_800_000_000_000;
  expect(tokenExpiry(jwt({ exp: 1_800_000_600 }))).toBe(1_800_000_600);
  expect(accessTokenExpired(jwt({ exp: 1_800_000_600 }), now)).toBe(false);
  expect(accessTokenExpired(jwt({ exp: 1_800_000_020 }), now)).toBe(true);   // noch 20 s - zu knapp (30 s Rand)
  expect(accessTokenExpired(jwt({ exp: 1_799_999_000 }), now)).toBe(true);
  expect(accessTokenExpired(jwt({ sub: "u" }), now)).toBe(true);
  expect(accessTokenExpired("kein-token", now)).toBe(true);
  expect(accessTokenExpired(null, now)).toBe(true);
  expect(tokenExpiry("a.b")).toBeNull();
});

// #1519: die Laufzeit (exp - iat) zählt ab Erhalt auf der Geräteuhr - eine falsch gehende Uhr verschiebt das Ende nicht.
describe("Laufzeit ab Erhalt statt Geräteuhr (#1519)", () => {
  const serverNow = 1_800_000_000; // Sekunden, Uhr des Servers beim Ausstellen
  const token = jwt({ iat: serverNow, exp: serverNow + 12 * 3600 });
  const hour = 3600 * 1000;

  test("Laufzeit aus dem Token", () => {
    expect(tokenLifetime(token)).toBe(12 * 3600);
    expect(tokenLifetime(jwt({ exp: serverNow }))).toBeNull();
  });

  test("vorgehende Geräteuhr (ein Tag): das frische Token gilt weiter, kein Erneuern bei jedem Aufruf", () => {
    const received = serverNow * 1000 + 24 * hour;
    expect(accessTokenExpired(token, received, 30)).toBe(true); // gegen exp: sofort abgelaufen
    expect(accessTokenExpired(token, received, 30, received)).toBe(false);
    expect(accessTokenExpired(token, received + 11 * hour, 30, received)).toBe(false);
    expect(accessTokenExpired(token, received + 12 * hour, 30, received)).toBe(true);
  });

  test("nachgehende Geräteuhr (ein Tag): nach 12 Stunden ist das Token abgelaufen, nicht erst nach 36", () => {
    const received = serverNow * 1000 - 24 * hour;
    expect(accessTokenExpired(token, received + 13 * hour, 30)).toBe(false); // gegen exp: hielte es für gültig
    expect(accessTokenExpired(token, received + 13 * hour, 30, received)).toBe(true);
    expect(accessTokenExpired(token, received + 6 * hour, 30, received)).toBe(false);
  });

  test("zurückgestellte Uhr seit dem Erhalt: lieber einmal erneuern", () => {
    const received = serverNow * 1000;
    expect(accessTokenExpired(token, received - hour, 30, received)).toBe(true);
  });

  test("ältere Tokens ohne iat: wie bisher gegen exp", () => {
    const old = jwt({ exp: serverNow + 600 });
    expect(accessTokenExpired(old, serverNow * 1000, 30, serverNow * 1000 - 24 * hour)).toBe(false);
  });
});

test("Netzfehler ja, Serverantworten nein; abgelehnt nur bei 401 und 403", () => {
  expect(isNetworkError({ code: "ERR_NETWORK", message: "Network Error" })).toBe(true);
  expect(isNetworkError({ code: "ECONNABORTED", message: "timeout of 15000ms exceeded" })).toBe(true);
  expect(isNetworkError({ message: "Network Error" })).toBe(true);
  expect(isNetworkError({ response: { status: 500 } })).toBe(false);
  expect(isNetworkError(new Error("401"))).toBe(false);
  expect(isNetworkError(null)).toBe(false);
  expect(isSessionRejected({ response: { status: 401 } })).toBe(true);
  expect(isSessionRejected({ response: { status: 403 } })).toBe(true);
  expect(isSessionRejected({ response: { status: 500 } })).toBe(false);
  expect(isSessionRejected({ code: "ERR_NETWORK" })).toBe(false);
});
