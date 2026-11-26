import { render } from "@testing-library/react";
import { NumText } from "./NumText";

// Zahlen-Schrift im Satz (#1304): In „1,5 % · 9 Gruppen“ oder „Level 12“ stehen nur die Zahlen in Rajdhani mit gleich
// breiten Ziffern (tls-type-num), die Wörter daneben bleiben in der Schrift der Stelle. Der Text selbst bleibt gleich.

test("Zahlen bekommen tls-type-num, Wörter nicht", () => {
  const { container } = render(<p><NumText text="1,5 % · 9 Gruppen" /></p>);
  const nums = [...container.querySelectorAll(".tls-type-num")].map((node) => node.textContent);
  expect(nums).toEqual(["1,5 %", "9"]);
  expect(container.textContent).toBe("1,5 % · 9 Gruppen");
});

test("Zeiten, Brüche und Vorzeichen bleiben eine Zahl", () => {
  const { container } = render(<p><NumText text="noch 12:30 · 3/12 · +2 · 1.234 Punkte" /></p>);
  expect([...container.querySelectorAll(".tls-type-num")].map((node) => node.textContent)).toEqual(["12:30", "3/12", "+2", "1.234"]);
});

test("ohne Zahl und ohne Text: nichts Zusätzliches", () => {
  const { container } = render(<p><NumText text="vorbei" /><NumText text={null} /><NumText text={42} /></p>);
  expect(container.querySelectorAll(".tls-type-num")).toHaveLength(1);
  expect(container.textContent).toBe("vorbei42");
});
