import { safeHttpUrl } from "./safeLink";

test.each(["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,test", "//example.test/clip", "http://[::1", "https://example.test/\nclip", "", null, undefined, 42])(
  "kein Link für unsicheren Nachweis: %s",
  (url) => {
    expect(safeHttpUrl(url)).toBe("");
  },
);

test.each(["https://example.test/clip?t=12#start", "http://example.test/clip"])("http(s)-Nachweis bleibt erhalten: %s", (url) => {
  expect(safeHttpUrl(url)).toBe(url);
});
