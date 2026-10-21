import { describe, expect, it } from "vitest";
import { chronicleHost, inheritedPartners, organizerSuggestion, roleOf, setPartnerRole, togglePartner } from "./seriesPartners";

// Partner an Serien und Ligen (#1934) - nur erfundene Namen.
const PARTNERS = [{ id: "p1", name: "Probe Ananas" }, { id: "p2", name: "Probe Kokos" }];

describe("seriesPartners", () => {
  it("adds new partners as contributors and drops the role of removed ones", () => {
    let value = togglePartner({}, "p1", true);
    expect(value).toEqual({ partner_ids: ["p1"], partner_roles: { p1: "contributor" } });
    value = setPartnerRole(value, "p1", "organizer");
    value = togglePartner(value, "p2", true);
    expect(value).toEqual({ partner_ids: ["p1", "p2"], partner_roles: { p1: "organizer", p2: "contributor" } });
    expect(togglePartner(value, "p1", false)).toEqual({ partner_ids: ["p2"], partner_roles: { p2: "contributor" } });
  });

  it("reads old lineages without roles as contributors", () => {
    expect(roleOf({ partner_ids: ["p1"] }, "p1")).toBe("contributor");
  });

  it("suggests the organizer name only while the field is empty", () => {
    const value = { partner_ids: ["p2", "p1"], partner_roles: { p1: "organizer" } };
    expect(organizerSuggestion(PARTNERS, value, "")).toBe("Probe Ananas");
    expect(organizerSuggestion(PARTNERS, value, "Probe Verband")).toBe("");
    expect(organizerSuggestion(PARTNERS, { partner_ids: ["p2"] }, "")).toBe("");
  });

  it("lists inherited partners of the lineage with their role", () => {
    const lineage = { partner_ids: ["p1", "weg"], partner_roles: { p1: "organizer" } };
    expect(inheritedPartners(lineage, PARTNERS)).toEqual([{ id: "p1", name: "Probe Ananas", role: "organizer" }]);
  });

  it("finds the hosting partner of a chronicle row from its season or its organizer name", () => {
    const season = { lineage: {}, season: { organizers: [{ id: "p2", name: "Probe Kokos" }] } };
    expect(chronicleHost({ partners: [] }, season)?.id).toBe("p2");
    expect(chronicleHost({ organizer: "probe ananas ", partners: PARTNERS }, null)?.id).toBe("p1");
    expect(chronicleHost({ organizer: "Probe Verband", partners: PARTNERS }, null)).toBeNull();
  });
});
