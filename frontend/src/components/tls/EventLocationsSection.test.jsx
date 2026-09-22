import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventLocationsSection, formToLocations, locationsFormError, locationsToForm } from "./EventLocationsSection";

// Standorte (#203): hinzufügen, sortieren, entfernen; Formular ↔ Server.

function Harness({ initial = [] }) {
  const [value, setValue] = useState(initial);
  return <EventLocationsSection value={value} onChange={setValue} />;
}

test("hinzufügen, nach oben schieben, entfernen", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  expect(screen.queryByTestId("event-location-0")).not.toBeInTheDocument();
  await user.click(screen.getByTestId("event-locations-add"));
  await user.click(screen.getByTestId("event-locations-add"));
  await user.type(screen.getByTestId("event-location-name-0"), "Vereinsheim");
  await user.type(screen.getByTestId("event-location-name-1"), "Kartbahn");
  await user.click(screen.getByLabelText("Standort 2 nach oben"));
  expect(screen.getByTestId("event-location-name-0")).toHaveValue("Kartbahn");
  expect(screen.getByTestId("event-location-name-1")).toHaveValue("Vereinsheim");
  await user.click(screen.getByLabelText("Standort 1 entfernen"));
  expect(screen.getByTestId("event-location-name-0")).toHaveValue("Vereinsheim");
  expect(screen.queryByTestId("event-location-1")).not.toBeInTheDocument();
});

test("Fehlertexte und Umwandlung zum Server", () => {
  expect(locationsFormError([{ name: "", address: "", city: "" }])).toMatch(/Standort 1: Name oder Adresse/);
  expect(locationsFormError([{ name: "x", max_participants: "viele" }])).toMatch(/Plätze als Zahl/);
  expect(locationsFormError([{ name: "x", max_participants: "" }])).toBe("");
  const form = locationsToForm([{ key: "ort-1", name: "Vereinsheim", city: "Telfs", start_date: "2026-10-31T14:00:00+00:00", max_participants: 30 }]);
  expect(form[0].max_participants).toBe(30);
  const out = formToLocations([{ ...form[0], start_date: "" }, { ...form[0], key: "", name: "Kartbahn", max_participants: "" }]);
  expect(out[0].start_date).toBeNull();
  expect(out[1].key).toBe("ort-2");
  expect(out[1].max_participants).toBeNull();
});
