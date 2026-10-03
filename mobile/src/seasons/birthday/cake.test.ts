import { hashString } from "../rng";
import { MAX_CANDLES, cakePlan, ignitionOrder } from "./cake";

// Die Torte in der App (B1 #749): dieselbe Rechnung wie im Web - derselbe Fingerabdruck wie in
// frontend/src/seasons/birthday/cake.test.js. Kerzen = Jahre, ab dreizehn Zahlkerzen.

const CAKE_PARITY = 3401302350;

test("Parität mit dem Web: dieselbe Torte für 8 Jahre im Jahr 2027", () => {
  expect(hashString(JSON.stringify(cakePlan(8, 2027)))).toBe(CAKE_PARITY);
});

test("Kerzen nach Jahren, Zahlkerzen ab dreizehn, ohne Jahre eine", () => {
  expect(cakePlan(8, 2027).candles).toHaveLength(8);
  expect(cakePlan(MAX_CANDLES, 2027).numbers).toBe(false);
  expect(cakePlan(13, 2032).digits.map((candle) => candle.digit).join("")).toBe("13");
  expect(cakePlan(null, 2027).candles).toHaveLength(1);
  expect(ignitionOrder(cakePlan(3, 2027), 100).map((step) => step.at)).toEqual([0, 100, 200]);
});
