export function applyCspNonce(element) {
  if (!element || typeof document === "undefined") return element;
  const nonce = document.querySelector('meta[name="csp-nonce"]')?.getAttribute("content")?.trim();
  if (nonce) element.setAttribute("nonce", nonce);
  return element;
}
