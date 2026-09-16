module.exports = {
  preset: "jest-expo",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testMatch: ["<rootDir>/src/**/*.test.{ts,tsx}"],
  // Der erste Test einer Datei trägt auf dem GitHub-Runner den Kaltstart der
  // Übersetzung (6 s je Datei bei 18 Dateien auf zwei Kernen). 5 s reichten
  // dort nicht mehr, lokal schon; die Tests selbst warten höchstens 1 s.
  testTimeout: 15000,
  collectCoverageFrom: ["src/**/*.{ts,tsx}", "!src/**/*.d.ts"],
};
