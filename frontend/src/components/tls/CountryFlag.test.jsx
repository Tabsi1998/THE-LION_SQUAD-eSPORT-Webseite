import { render, screen } from "@testing-library/react";
import { CountryFlag, VenueWithFlag } from "@/components/tls/CountryFlag";

// Flagge je Termin (#1925): Datei je Land, Alternativtext = Landesname, fester Kasten nach dem echten
// Seitenverhältnis (kein Springen beim Laden).

const size = (img) => [img.getAttribute("width"), img.getAttribute("height")];

test("die Flagge ist ein Bild mit dem Landesnamen als Alternativtext und festem Kasten", () => {
  render(<CountryFlag code="AZ" />);
  const flag = screen.getByRole("img", { name: "Aserbaidschan" });
  expect(flag.getAttribute("src")).toBe("/assets/flags/az.svg");
  expect(size(flag)).toEqual(["28", "14"]);
  expect(flag.getAttribute("data-country")).toBe("AZ");
});

test("gleiche Höhe, Breite nach dem Seitenverhältnis bis höchstens 2:1", () => {
  const { container, rerender } = render(<CountryFlag code="CH" />);
  expect(size(container.querySelector("img"))).toEqual(["14", "14"]);
  rerender(<CountryFlag code="IT" />);
  expect(size(container.querySelector("img"))).toEqual(["21", "14"]);
  // Katar ist breiter als 2:1 - der Kasten bleibt 2:1, die Flagge passt sich ein.
  rerender(<CountryFlag code="QA" />);
  expect(size(container.querySelector("img"))).toEqual(["28", "14"]);
});

test("klein für Spaltenköpfe, ohne bekanntes Land gar nichts", () => {
  const { container, rerender } = render(<CountryFlag code="it" size="sm" />);
  expect(size(container.querySelector("img"))).toEqual(["18", "12"]);
  rerender(<CountryFlag code="XX" />);
  expect(container.querySelector("img")).toBeNull();
  rerender(<CountryFlag code={null} />);
  expect(container.querySelector("img")).toBeNull();
});

test("Ort mit Flagge: ohne Ort und Titel steht der Landesname", () => {
  const { container, rerender } = render(<VenueWithFlag round={{ venue: "Baku", country_code: "AZ" }} />);
  expect(container.textContent).toBe("Baku");
  expect(screen.getByRole("img", { name: "Aserbaidschan" })).toBeTruthy();
  rerender(<VenueWithFlag round={{ country_code: "JP" }} />);
  expect(container.textContent).toBe("Japan");
  rerender(<VenueWithFlag round={{ title: "Finale", venue: "Monza", country_code: null }} />);
  expect(container.textContent).toBe("Finale · Monza");
  expect(container.querySelector("img")).toBeNull();
  rerender(<VenueWithFlag round={{}} />);
  expect(container.textContent).toBe("");
});
