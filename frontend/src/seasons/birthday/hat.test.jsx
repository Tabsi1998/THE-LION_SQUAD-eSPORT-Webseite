import { render, screen } from "@testing-library/react";
import { BirthdayHatArt, hatNumber } from "./hat";

// Die Geburtstagsmütze (#856): vorne die Zahl der Jahre, ab drei Ziffern ein Stern; anders gefärbt als der Partyhut.

test("die Zahl auf der Mütze: bis zwei Ziffern, sonst ein Stern", () => {
  expect(hatNumber(8)).toBe("8");
  expect(hatNumber(12)).toBe("12");
  expect(hatNumber(105)).toBe("");
  expect(hatNumber(null)).toBe("");
  expect(hatNumber(0)).toBe("");
});

test("die Mütze zeigt die Jahre - ohne Jahre einen Stern", () => {
  const { container, rerender } = render(<BirthdayHatArt size={30} years={8} />);
  expect(screen.getByTestId("birthday-hat-number")).toHaveTextContent("8");
  expect(screen.getByTestId("birthday-hat-art")).toHaveAttribute("width", "30");
  expect(container.querySelector("linearGradient")).not.toBeNull();
  rerender(<BirthdayHatArt size={30} years={null} />);
  expect(screen.queryByTestId("birthday-hat-number")).toBeNull();
});

test("zwei Mützen auf einer Seite teilen sich keine Kennungen", () => {
  const { container } = render(<><BirthdayHatArt years={8} /><BirthdayHatArt years={8} /></>);
  const ids = [...container.querySelectorAll("[id]")].map((node) => node.id);
  expect(new Set(ids).size).toBe(ids.length);
});
