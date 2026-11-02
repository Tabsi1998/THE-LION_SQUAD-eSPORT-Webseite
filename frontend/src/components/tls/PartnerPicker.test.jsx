import { fireEvent, render, screen } from "@testing-library/react";
import { PartnerPicker } from "./PartnerPicker";
import { SeriesPartnersField } from "@/pages/admin/referenceSeries/SeriesPartnersField";

// Archivierte Partner (#2130): Die Auswahl zeigt nur aktive; wer schon verknüpft ist, bleibt und lässt sich lösen.

const PARTNERS = [{ id: "p-1", name: "Aktiver Verein" }];

test("ein archivierter Partner bleibt beim Haken-Setzen dran und lässt sich lösen", () => {
  const onChange = vi.fn();
  render(<PartnerPicker partners={PARTNERS} value={["p-alt"]} onChange={onChange} testPrefix="x" />);
  expect(screen.getByTestId("x-archived")).toHaveTextContent("1 archivierter Partner bleibt verknüpft");
  fireEvent.click(screen.getByTestId("x-p-1"));
  expect(onChange).toHaveBeenLastCalledWith(["p-alt", "p-1"]);
  fireEvent.click(screen.getByTestId("x-archived-remove"));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test("ohne archivierte Partner kein Hinweis", () => {
  render(<PartnerPicker partners={PARTNERS} value={["p-1"]} onChange={() => {}} testPrefix="x" />);
  expect(screen.queryByTestId("x-archived")).toBeNull();
});

test("Serie: Lösen nimmt auch die Rolle mit", () => {
  const onChange = vi.fn();
  render(<SeriesPartnersField partners={PARTNERS} value={{ partner_ids: ["p-1", "p-alt"], partner_roles: { "p-1": "organizer", "p-alt": "organizer" } }} onChange={onChange} testPrefix="y" />);
  fireEvent.click(screen.getByTestId("y-archived-remove"));
  expect(onChange).toHaveBeenCalledWith({ partner_ids: ["p-1"], partner_roles: { "p-1": "organizer" } });
});
