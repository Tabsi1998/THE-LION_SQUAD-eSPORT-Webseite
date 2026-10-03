import { hashString } from "../rng";
import { cakePlan, ignitionOrder } from "./cake";

// Die Torte in der App (B1 #749): dieselbe Rechnung wie im Web - derselbe Fingerabdruck wie in
// frontend/src/seasons/birthday/cake.test.js. Die Jahre als Zahlkerzen (#856).

const CAKE_PARITY = 1925493762;

test("Parität mit dem Web: dieselbe Torte für 8 Jahre im Jahr 2027", () => {
  expect(hashString(JSON.stringify(cakePlan(8, 2027)))).toBe(CAKE_PARITY);
});

test("die Jahre als Zahlkerzen, ohne Jahre eine „1“", () => {
  expect(cakePlan(8, 2027).digits.map((candle) => candle.digit).join("")).toBe("8");
  expect(cakePlan(8, 2027).candles).toEqual([]);
  expect(cakePlan(13, 2032).digits.map((candle) => candle.digit).join("")).toBe("13");
  expect(cakePlan(null, 2027).digits.map((candle) => candle.digit).join("")).toBe("1");
  expect(ignitionOrder(cakePlan(105, 2027), 100).map((step) => step.at)).toEqual([0, 100, 200]);
});
