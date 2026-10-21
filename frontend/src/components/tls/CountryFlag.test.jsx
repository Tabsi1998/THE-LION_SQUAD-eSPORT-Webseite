import { render, screen } from "@testing-library/react";
import { CountryFlag, VenueWithFlag } from "@/components/tls/CountryFlag";

// Flagge je Termin (#1925): eigene Datei, Alternativtext = Landesname, feste Größe (kein Springen beim Laden).

test("die Flagge ist ein Bild mit dem Landesnamen als Alternativtext und fester Größe", () => {
  render(<CountryFlag code="AZ" />);
  const flag = screen.getByRole("img", { name: "Aserbaidschan" });
  expect(flag.getAttribute("src")).toBe("/assets/flags/az.svg");
  expect(flag.getAttribute("width")).toBe("20");
  expect(flag.getAttribute("height")).toBe("15");
  expect(flag.getAttribute("data-country")).toBe("AZ");
});

test("klein für Spaltenköpfe, ohne bekanntes Land gar nichts", () => {
  const { container, rerender } = render(<CountryFlag code="it" size="sm" />);
  expect(container.querySelector("img").getAttribute("width")).toBe("16");
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
