import { PROFILE_LIMITS, profileFieldErrors } from "./form";

// Längengrenzen (#2126): gleich im Server (backend/routes/user_routes.py).
test("Anzeigename: leer oder zu lang hat einen Hinweis, genau die Grenze nicht", () => {
  expect(profileFieldErrors({ display_name: "   " }).display_name).toMatch(/Anzeigenamen/);
  expect(profileFieldErrors({ display_name: "x".repeat(PROFILE_LIMITS.display_name) }).display_name).toBeUndefined();
  expect(profileFieldErrors({ display_name: "x".repeat(PROFILE_LIMITS.display_name + 1) }).display_name).toBe("Höchstens 50 Zeichen.");
});

test("Bio: höchstens 1000 Zeichen, leer ist erlaubt", () => {
  expect(profileFieldErrors({ bio: "" }).bio).toBeUndefined();
  expect(profileFieldErrors({ bio: "x".repeat(PROFILE_LIMITS.bio) }).bio).toBeUndefined();
  expect(profileFieldErrors({ bio: "x".repeat(PROFILE_LIMITS.bio + 1) }).bio).toBe("Höchstens 1000 Zeichen.");
});
