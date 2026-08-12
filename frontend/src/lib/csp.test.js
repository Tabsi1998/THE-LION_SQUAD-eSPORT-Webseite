import { applyCspNonce } from "./csp";

afterEach(() => {
  document.head.innerHTML = "";
});

test("applies the nginx CSP nonce to runtime scripts", () => {
  const meta = document.createElement("meta");
  meta.name = "csp-nonce";
  meta.content = "request-nonce-123";
  document.head.appendChild(meta);
  const script = document.createElement("script");

  applyCspNonce(script);

  expect(script.getAttribute("nonce")).toBe("request-nonce-123");
});

test("leaves scripts unchanged when local development has no nonce", () => {
  const script = document.createElement("script");
  expect(applyCspNonce(script)).toBe(script);
  expect(script.hasAttribute("nonce")).toBe(false);
});
