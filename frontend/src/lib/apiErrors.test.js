// Fehlertexte aus Server-Antworten: auch eine kurze Text-Antwort (statt JSON mit „detail“) erscheint im Klartext -
// vorher stand bei 400 „Invalid host header“ nur „Request failed with status code 400“.
import { describe, expect, test } from "vitest";
import { formatRequestError, formatUploadError } from "./api";

const failed = (status, data) => ({ message: `Request failed with status code ${status}`, response: { status, data } });

describe("formatRequestError", () => {
  test("nimmt weiter zuerst das detail aus JSON", () => {
    expect(formatRequestError(failed(400, { detail: "Bitte die Platzierung wählen." }))).toBe("Bitte die Platzierung wählen.");
  });

  test("zeigt eine kurze Text-Antwort statt der allgemeinen Meldung", () => {
    expect(formatRequestError(failed(400, "Invalid host header")))
      .toBe("Der Server hat die Anfrage abgelehnt (400): Invalid host header");
  });

  test("lässt HTML-Seiten und leere Antworten weg", () => {
    expect(formatRequestError(failed(502, "<html><body>Bad Gateway</body></html>"))).toBe("Request failed with status code 502");
    expect(formatRequestError(failed(400, "  "))).toBe("Request failed with status code 400");
  });
});

describe("formatUploadError", () => {
  test("nennt eine kurze Text-Antwort mit Status", () => {
    expect(formatUploadError(failed(400, "Invalid host header"))).toBe("Upload fehlgeschlagen (400): Invalid host header");
  });
});
