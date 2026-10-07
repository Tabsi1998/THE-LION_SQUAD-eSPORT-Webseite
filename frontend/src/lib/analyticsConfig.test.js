import {
  withoutSecretParams,
  isGoogleMeasurementId,
  normalizeAnalyticsPayload,
  normalizeGoogleMeasurementId,
  normalizePlausibleDomain,
} from "./analyticsConfig";

test("normalizes Google Measurement IDs", () => {
  expect(normalizeGoogleMeasurementId(" g-3x155kw480 ")).toBe("G-3X155KW480");
});

test("validates GA4 Measurement IDs", () => {
  expect(isGoogleMeasurementId("G-3X155KW480")).toBe(true);
  expect(isGoogleMeasurementId("UA-123456-1")).toBe(false);
  expect(isGoogleMeasurementId("")).toBe(false);
});

test("normalizes analytics branding payload", () => {
  expect(normalizeAnalyticsPayload({
    google_analytics_id: " g-abc123 ",
    plausible_domain: "https://lionsquad.at/path",
  })).toMatchObject({
    google_analytics_id: "G-ABC123",
    plausible_domain: "lionsquad.at",
  });
});

test("normalizes Plausible domains", () => {
  expect(normalizePlausibleDomain("https://www.lionsquad.at/dashboard")).toBe("www.lionsquad.at");
});

test("Schlüssel in Links gehen nie an die Statistik (#1110)", () => {
  expect(withoutSecretParams("https://club.example/display/bracket/t1?key=geheim&text_size=large")).toBe("https://club.example/display/bracket/t1?text_size=large");
  expect(withoutSecretParams("/tournaments/cup?access=abc")).toBe("/tournaments/cup");
  expect(withoutSecretParams("/display/bracket/t1?key=x&preview=y#oben")).toBe("/display/bracket/t1#oben");
  expect(withoutSecretParams("/news?page=2")).toBe("/news?page=2");
  expect(withoutSecretParams("")).toBe("");
});
