import { tiltFor } from "./useTilt";

// Leichtes 3D (#1078): höchstens 3 Grad, Mitte = keine Neigung, Ränder = volle Neigung, außerhalb begrenzt.
test("tiltFor: Mitte null, Ränder höchstens drei Grad, außerhalb begrenzt", () => {
  expect(tiltFor(100, 50, 200, 100)).toEqual({ x: 0, y: 0 });
  expect(tiltFor(200, 50, 200, 100)).toEqual({ x: 0, y: 3 });
  expect(tiltFor(0, 0, 200, 100)).toEqual({ x: 3, y: -3 });
  expect(tiltFor(999, -50, 200, 100)).toEqual({ x: 3, y: 3 });
  expect(tiltFor(150, 25, 200, 100, 2)).toEqual({ x: 1, y: 1 });
  expect(tiltFor(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
});
