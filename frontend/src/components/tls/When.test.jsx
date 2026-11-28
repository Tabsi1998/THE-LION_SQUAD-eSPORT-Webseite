import { render } from "@testing-library/react";
import { When } from "./When";

// <When> (#1307): sichtbar die eine Form, dazu <time dateTime> - der Mittelpunkt wird nicht vorgelesen.
const NOW = new Date("2026-05-20T10:00:00Z");

test("Tag und Uhrzeit als <time> mit ISO-Wert, der Mittelpunkt bleibt stumm", () => {
  const { container } = render(<When value="2026-05-23T16:00:00Z" now={NOW} />);
  const time = container.querySelector("time");
  expect(time).toHaveAttribute("dateTime", "2026-05-23T16:00:00.000Z");
  expect(time).toHaveTextContent(/^Sa 23\. Mai · 18:00$/);
  expect(time.querySelector('[aria-hidden="true"]')).toHaveTextContent("·");
});

test("heute ohne Mittelpunkt, reiner Tag mit dem Tag als dateTime", () => {
  const today = render(<When value="2026-05-20T16:00:00Z" now={NOW} />);
  expect(today.container.querySelector("time")).toHaveTextContent(/^heute 18:00$/);
  expect(today.container.querySelector('[aria-hidden="true"]')).toBeNull();
  const day = render(<When value="2026-12-31" now={NOW} />);
  expect(day.container.querySelector("time")).toHaveAttribute("dateTime", "2026-12-31");
  expect(day.container.querySelector("time")).toHaveTextContent(/^Do 31\. Dezember$/);
});

test("nur die Uhrzeit, wo der Tag schon darübersteht", () => {
  const { container } = render(<When value="2026-05-19T10:10:00Z" now={NOW} clock />);
  expect(container.querySelector("time")).toHaveTextContent(/^12:10$/);
});

test("vergangen in Listen, ohne Wert der Platzhalter als Text", () => {
  const ago = render(<When value="2026-05-20T09:48:00Z" now={NOW} ago />);
  expect(ago.container.querySelector("time")).toHaveTextContent("vor 12 Min.");
  const empty = render(<p data-testid="leer"><When value={null} fallback="Termin offen" /></p>);
  expect(empty.getByTestId("leer")).toHaveTextContent("Termin offen");
  expect(empty.container.querySelector("time")).toBeNull();
});
