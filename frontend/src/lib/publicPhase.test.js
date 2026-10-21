import { isPublicLive, publicState } from "./publicPhase";

// #1888: öffentliche Anzeigen folgen der Phase vom Server, nicht dem Rohstatus.

test("die öffentliche Phase geht vor dem Rohstatus", () => {
  const stuck = { status: "live", public_phase: { state: "completed", label: "Beendet" } };
  expect(publicState(stuck)).toBe("completed");
  expect(isPublicLive(stuck)).toBe(false);
});

test("ohne Phase gilt der Rohstatus - auch als Text und als event_phase", () => {
  expect(publicState({ status: "LIVE" })).toBe("live");
  expect(isPublicLive({ status: "live" })).toBe(true);
  expect(publicState({ status: "live", public_phase: "completed" })).toBe("completed");
  expect(publicState({ status: "live", event_phase: { state: "day_break" } })).toBe("day_break");
  expect(publicState(null)).toBe("");
  expect(isPublicLive(undefined)).toBe(false);
});

test("eine Phase „live“ zählt auch, wenn der Rohstatus noch „scheduled“ ist", () => {
  expect(isPublicLive({ status: "scheduled", public_phase: { state: "live" } })).toBe(true);
});
