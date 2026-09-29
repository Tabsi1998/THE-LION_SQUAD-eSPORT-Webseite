import { fireEvent, render, screen } from "@testing-library/react";
import { SeasonsWeatherCard, compass, skyText, weatherText } from "./SeasonsWeatherCard";

// Wetter am Vereinsort (#666): Satz in Worten, Himmelsrichtung, Vorgabe bei altem Stand, Ort speichern nur mit
// gültigen Zahlen und nur bei Änderung, „Jetzt abrufen“.

const FRESH = { location: "Innsbruck", night: true, sunrise: "2026-10-31T06:55:00+01:00", sunset: "2026-10-31T16:52:00+01:00", temp_c: 11.3, wind_kmh: 14.8, wind_dir: 250, wind_factor: 0.89, rain_mm: 0.2, snow_cm: 0, code: 61, fetched_at: "2026-10-31T20:10:00+01:00", stale: false, error: null, source: "open-meteo" };
const LOCATION = { lat: 47.2692, lon: 11.4041, name: "Innsbruck" };

test("Himmelsrichtung und Wetterwort", () => {
  expect(compass(0)).toBe("N");
  expect(compass(250)).toBe("W");
  expect(compass(135)).toBe("SO");
  expect(compass(359)).toBe("N");
  expect(skyText(0)).toBe("klar");
  expect(skyText(61)).toBe("Regen");
  expect(skyText(73)).toBe("Schnee");
  expect(skyText(95)).toBe("Gewitter");
  expect(skyText(null)).toBe("");
});

test("Wetter in Worten, Vorgabe bei altem oder fehlendem Stand", () => {
  expect(weatherText(FRESH)).toBe("11,3 °C, Wind 15 km/h aus W, Regen, Regen 0,2 mm");
  expect(weatherText({ ...FRESH, snow_cm: 2.5, code: 73 })).toContain("Schnee 2,5 cm");
  expect(weatherText({ ...FRESH, stale: true })).toMatch(/Vorgabe/);
  expect(weatherText(null)).toMatch(/Noch kein Wetter/);
});

test("Karte: Satz, Sonnenzeiten, Ort speichern nur bei Änderung und gültigen Zahlen, Abruf-Knopf", () => {
  const onSave = vi.fn();
  const onRefresh = vi.fn();
  render(<SeasonsWeatherCard weather={FRESH} location={LOCATION} busy={false} onSave={onSave} onRefresh={onRefresh} />);
  expect(screen.getByTestId("seasons-weather-text")).toHaveTextContent("Innsbruck: 11,3 °C, Wind 15 km/h aus W");
  expect(screen.getByTestId("seasons-weather-sun")).toHaveTextContent("gerade Nacht");
  const save = screen.getByTestId("seasons-location-save");
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByTestId("seasons-location-lat"), { target: { value: "47,3" } });
  fireEvent.change(screen.getByTestId("seasons-location-name"), { target: { value: "Telfs" } });
  expect(save).not.toBeDisabled();
  fireEvent.submit(screen.getByTestId("seasons-location-form"));
  expect(onSave).toHaveBeenCalledWith({ lat: 47.3, lon: 11.4041, name: "Telfs" });
  fireEvent.change(screen.getByTestId("seasons-location-lat"), { target: { value: "95" } });
  expect(save).toBeDisabled();
  expect(screen.getByText(/Breite −90 bis 90/)).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("seasons-weather-refresh"));
  expect(onRefresh).toHaveBeenCalledTimes(1);
});

test("Was die Seite aus dem Wetter macht: Regen das ganze Jahr, Schnee statt Regen im Winter, aus ohne die Saison Wetter", () => {
  const props = { location: LOCATION, busy: false, onSave: vi.fn(), onRefresh: vi.fn() };
  const { rerender } = render(<SeasonsWeatherCard weather={{ ...FRESH, rain_mm: 1.2, snow_cm: 0 }} seasons={[{ key: "weather", effective: "normal" }, { key: "halloween", effective: "normal" }]} {...props} />);
  expect(screen.getByTestId("seasons-weather-layer")).toHaveTextContent("Auf der Seite regnet es: leichter Regen (65 % der Tropfen).");
  rerender(<SeasonsWeatherCard weather={{ ...FRESH, rain_mm: 1.2, snow_cm: 0 }} seasons={[{ key: "snow", effective: "normal" }, { key: "advent", effective: "normal" }]} {...props} />);
  expect(screen.getByTestId("seasons-weather-layer")).toHaveTextContent("aus dem Regen draußen wird Schnee");
  rerender(<SeasonsWeatherCard weather={{ ...FRESH, rain_mm: 0, snow_cm: 2 }} seasons={[{ key: "snow", effective: "normal" }]} {...props} />);
  expect(screen.getByTestId("seasons-weather-layer")).toHaveTextContent("es schneit draußen, auf der Seite schneit es dichter (125 % der Flocken)");
  rerender(<SeasonsWeatherCard weather={{ ...FRESH, rain_mm: 1.2 }} {...props} />);
  expect(screen.getByTestId("seasons-weather-layer")).toHaveTextContent("Das Wetter auf der Seite ist ausgeschaltet");
});
