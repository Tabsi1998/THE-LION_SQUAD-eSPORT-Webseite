import { createElement } from "react";
import { fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { tiltFor, useTilt } from "./useTilt";

// Leichtes 3D (#1078): höchstens 3 Grad, Mitte = keine Neigung, Ränder = volle Neigung, außerhalb begrenzt.
test("tiltFor: Mitte null, Ränder höchstens drei Grad, außerhalb begrenzt", () => {
  expect(tiltFor(100, 50, 200, 100)).toEqual({ x: 0, y: 0 });
  expect(tiltFor(200, 50, 200, 100)).toEqual({ x: 0, y: 3 });
  expect(tiltFor(0, 0, 200, 100)).toEqual({ x: 3, y: -3 });
  expect(tiltFor(999, -50, 200, 100)).toEqual({ x: 3, y: 3 });
  expect(tiltFor(150, 25, 200, 100, 2)).toEqual({ x: 1, y: 1 });
  expect(tiltFor(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
});

const realMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = realMatchMedia;
});

function media({ fine = true, reduce = false } = {}) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes("pointer: fine") ? fine : query.includes("prefers-reduced-motion") ? reduce : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

// Wie Profil und Team: zuerst „Lade …“, der Kopf erscheint erst nach dem Laden.
function Head({ ready, enabled = true }) {
  const tiltRef = useTilt({ enabled });
  if (!ready) return createElement("p", null, "Lade …");
  return createElement("div", { ref: tiltRef, "data-testid": "head" });
}

function showHead(props = {}) {
  const view = render(createElement(Head, { ready: false, ...props }));
  view.rerender(createElement(Head, { ready: true, ...props }));
  const head = view.getByTestId("head");
  head.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100 });
  return { view, head };
}

test("useTilt: greift auch, wenn der Kopf erst nach dem Laden erscheint, und legt sich beim Verlassen zurück", () => {
  media();
  const { head } = showHead();
  fireEvent.pointerMove(head, { clientX: 200, clientY: 50 });
  expect(head.style.getPropertyValue("--tls-tilt-y")).toBe("3deg");
  expect(head.style.getPropertyValue("--tls-tilt-x")).toBe("0deg");
  expect(head.style.getPropertyValue("--tls-tilt-on")).toBe("1");
  fireEvent.pointerLeave(head);
  expect(head.style.getPropertyValue("--tls-tilt-y")).toBe("0deg");
  expect(head.style.getPropertyValue("--tls-tilt-on")).toBe("0");
});

test("useTilt: nicht am Handy, nicht mit „Bewegung reduzieren“, nicht abgeschaltet", () => {
  for (const props of [{ media: { fine: false } }, { media: { reduce: true } }, { media: {}, enabled: false }]) {
    media(props.media);
    const { view, head } = showHead({ enabled: props.enabled ?? true });
    fireEvent.pointerMove(head, { clientX: 200, clientY: 50 });
    expect(head.style.getPropertyValue("--tls-tilt-on")).toBe("");
    view.unmount();
  }
});
