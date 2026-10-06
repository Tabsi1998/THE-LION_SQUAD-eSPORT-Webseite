import { accessTokenExpired, isNetworkError, isSessionRejected, tokenExpiry } from "./session";

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
