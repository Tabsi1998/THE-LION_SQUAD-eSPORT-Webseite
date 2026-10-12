import { sha256Hex } from "./sha256";

// Bekannte Prüfwerte (FIPS 180-2) und ein Text über mehrere Blöcke mit Umlauten.
test("SHA-256 liefert die bekannten Prüfwerte", () => {
  expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
  expect(sha256Hex("Löwe € 🦁")).toBe("f299821f5b3a728445876ae5885e5b12d35947a39d4a6439122c1849b76df6c8");});
