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

  // Die Meldung ist für die Person am Bildschirm (#2122): keine Rede von Proxy, Limit oder Statuszahl.
  test("zu groß: die Grenze vom Server und was zu tun ist", () => {
    const message = formatUploadError(failed(413, "<html>Too Large</html>"), "Upload fehlgeschlagen.", { appLimitMb: 50, proxyLimitMb: 63 });
    expect(message).toBe("Die Datei ist zu groß. Erlaubt sind höchstens 50 MB. Bitte eine kleinere Datei wählen.");
    expect(formatUploadError(failed(413, ""))).toBe("Die Datei ist zu groß. Bitte eine kleinere Datei wählen.");
  });

  test("eine Meldung des Servers kommt ohne Statuszahl", () => {
    expect(formatUploadError(failed(400, { detail: "Nur PNG, JPG oder WebP erlaubt." }))).toBe("Upload fehlgeschlagen: Nur PNG, JPG oder WebP erlaubt.");
  });

  test("keine Antwort: ohne Technik-Wörter", () => {
    const message = formatUploadError({ code: "ERR_NETWORK" }, "Upload fehlgeschlagen.", { appLimitMb: 50, proxyLimitMb: 63 });
    expect(message).toContain("Keine Antwort vom Server");
    expect(message).not.toMatch(/proxy|limit|timeout/i);
  });
});
