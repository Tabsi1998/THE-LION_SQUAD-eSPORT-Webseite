import { anyModalOpen, setModalOpen, whenNoModalOpen } from "./modalGate";

// Nie zwei Fenster übereinander (#1208): die Frage nach Benachrichtigungen wartet, bis kein gemeldetes Fenster mehr offen ist.

afterEach(() => {
  setModalOpen("abstimmung", false);
  setModalOpen("belohnung", false);
});

test("ohne offenes Fenster geht es sofort weiter", async () => {
  expect(anyModalOpen()).toBe(false);
  await expect(whenNoModalOpen()).resolves.toBeUndefined();
});

test("wartet, bis alle gemeldeten Fenster zu sind", async () => {
  setModalOpen("abstimmung", true);
  setModalOpen("belohnung", true);
  let done = false;
  void whenNoModalOpen().then(() => { done = true; });
  setModalOpen("abstimmung", false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).toBe(false);
  setModalOpen("belohnung", false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(done).toBe(true);
  expect(anyModalOpen()).toBe(false);
});
