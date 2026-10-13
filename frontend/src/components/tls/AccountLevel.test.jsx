import { render, screen } from "@testing-library/react";
import { AccountLevelPill, accountLevelFrameClass, accountLevelTier } from "./AccountLevel";

// Löwen-Rang (#1452): Pille, XP-Balken und Karten nennen denselben Rang-Namen wie Rahmen und Backend.

test("der Titel ist der Name des Löwen-Rangs", () => {
  expect(accountLevelTier(1).title).toBe("Jungtier");
  expect(accountLevelTier(9).title).toBe("Fährte");
  expect(accountLevelTier(20).title).toBe("Silbermähne");
  expect(accountLevelTier(55).title).toBe("Löwenkönig");
  expect(accountLevelTier(60)).toMatchObject({ title: "Löwenkönig", rank: 12 });
});

test("nur Cyan und Gold", () => {
  const colors = new Set(Array.from({ length: 60 }, (_, i) => accountLevelTier(i + 1).color));
  expect([...colors].sort()).toEqual(["#29B6E8", "#FFD700"]);
  expect(accountLevelFrameClass(1)).toContain("tls-account-frame");
  expect(accountLevelFrameClass(30)).toContain("tls-account-frame-elite");
});

test("die Pille zeigt Level und Rang", () => {
  render(<AccountLevelPill level={9} />);
  expect(screen.getByText(/Level 9 · Fährte/)).toBeInTheDocument();
});
