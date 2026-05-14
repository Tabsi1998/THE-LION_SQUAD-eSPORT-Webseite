import {
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
