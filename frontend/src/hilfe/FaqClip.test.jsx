import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import FaqClip, { clipQuellen } from "./FaqClip";
import { HANDY_QUERY, hilfeBild, hilfeClip, hilfeSchritte, hilfeThema } from "./index";

// FAQ-Schleifen (#2448): Gerätewahl über matchMedia, „Bewegung reduzieren“, Anhalten/Abspielen, Rückfall auf das Bild
// und Laden erst im Bild.

const SLUG = "turniere";
const SCHRITT = hilfeSchritte(hilfeThema(SLUG)).find((row) => row.id === "ergebnis-melden");
const OHNE_CLIP = hilfeSchritte(hilfeThema(SLUG)).find((row) => row.id === "einchecken");

let media;
let observers;

function setMedia({ handy = false, reduce = false } = {}) {
  media.values[HANDY_QUERY] = handy;
  media.values["(prefers-reduced-motion: reduce)"] = reduce;
}

function changeMedia(query, value) {
  media.values[query] = value;
  act(() => {
    for (const listener of media.listeners[query] || []) listener();
  });
}

function scrollInto(visible) {
  act(() => {
    for (const observer of observers) observer.callback([{ isIntersecting: visible }]);
  });
}

beforeEach(() => {
  media = { values: {}, listeners: {} };
  observers = [];
  vi.stubGlobal("matchMedia", (query) => ({
    get matches() { return Boolean(media.values[query]); },
    media: query,
    addEventListener: (_type, listener) => { (media.listeners[query] ||= []).push(listener); },
    removeEventListener: (_type, listener) => { media.listeners[query] = (media.listeners[query] || []).filter((row) => row !== listener); },
  }));
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
    disconnect() { observers = observers.filter((row) => row !== this); }
  });
  window.HTMLMediaElement.prototype.play = vi.fn(function play() {
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  window.HTMLMediaElement.prototype.pause = vi.fn(function pause() {
    this.dispatchEvent(new Event("pause"));
  });
  window.HTMLMediaElement.prototype.canPlayType = (type) => (type.includes("webm") ? "probably" : "maybe");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("die Schritte im Test haben (k)eine Schleife wie erwartet", () => {
  expect(SCHRITT.clip).toBe(true);
  expect(OHNE_CLIP.clip).toBeFalsy();
  expect(hilfeClip(SLUG, SCHRITT.id, "pc")).toBeTruthy();
});

test("Laden erst im Bild: vorher nur das Bild (lazy), im Bild die Schleife, außerhalb angehalten", () => {
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  expect(screen.queryByTestId(`help-step-clip-${SCHRITT.id}`)).toBeNull();
  const image = screen.getByTestId(`help-step-image-${SCHRITT.id}`);
  expect(image).toHaveAttribute("loading", "lazy");
  expect(image).toHaveAttribute("src", hilfeBild(SLUG, SCHRITT.id, "pc").src);
  expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

  scrollInto(true);
  const video = screen.getByTestId(`help-step-clip-${SCHRITT.id}`);
  expect(video).toHaveAttribute("preload", "none");
  expect(video).toHaveAttribute("loop");
  expect(video).toHaveAttribute("playsinline");
  expect(video.muted).toBe(true);
  expect(video).toHaveAttribute("poster", hilfeBild(SLUG, SCHRITT.id, "pc").src);
  expect(video).toHaveAttribute("aria-label", `Animation: ${SCHRITT.titel}`);
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);

  scrollInto(false);
  expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  // Wieder im Bild: läuft weiter, ohne neu zu laden (dasselbe Element).
  scrollInto(true);
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toBe(video);
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
});

test("Gerätewahl: am Handy die Handy-Fassung, am PC die PC-Fassung, bei Wechsel der Breite um", () => {
  setMedia({ handy: true });
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  expect(screen.getByTestId(`help-step-media-${SCHRITT.id}`)).toHaveAttribute("data-form", "handy");
  scrollInto(true);
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("src", hilfeClip(SLUG, SCHRITT.id, "handy").webm);
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("poster", hilfeBild(SLUG, SCHRITT.id, "handy").src);

  changeMedia(HANDY_QUERY, false);
  expect(screen.getByTestId(`help-step-media-${SCHRITT.id}`)).toHaveAttribute("data-form", "pc");
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("src", hilfeClip(SLUG, SCHRITT.id, "pc").webm);
});

test("ohne VP9 (ältere iPhones) die MP4-Fassung", () => {
  window.HTMLMediaElement.prototype.canPlayType = (type) => (type.includes("mp4") ? "maybe" : "");
  expect(clipQuellen({ webm: "/a.webm", mp4: "/a.mp4" })).toEqual([{ src: "/a.mp4", type: "video/mp4" }, { src: "/a.webm", type: "video/webm" }]);
  expect(clipQuellen({ webm: "/a.webm", mp4: null })).toEqual([{ src: "/a.webm", type: "video/webm" }]);
  expect(clipQuellen(null)).toEqual([]);
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("src", hilfeClip(SLUG, SCHRITT.id, "pc").mp4);
});

test("Anhalten und Abspielen über den Knopf, mit Label", () => {
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  const button = screen.getByTestId(`help-step-clip-toggle-${SCHRITT.id}`);
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ anhalten`);
  fireEvent.click(button);
  expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ abspielen`);
  expect(button).toHaveTextContent("Abspielen");
  // Angehalten bleibt angehalten, auch nach Scrollen.
  window.HTMLMediaElement.prototype.play.mockClear();
  scrollInto(false);
  scrollInto(true);
  expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ anhalten`);
});

test("Knopf zeigt gleich „Anhalten“, wenn die Schleife im Bild von selbst startet - kein kurzes „Abspielen“", () => {
  // play() meldet sich erst später (Laden): der Knopf richtet sich nach „im Bild und erlaubt“, nicht nach dem Ereignis.
  window.HTMLMediaElement.prototype.play = vi.fn(() => new Promise(() => {}));
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  expect(screen.getByTestId(`help-step-clip-toggle-${SCHRITT.id}`)).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ anhalten`);
});

test("lehnt der Browser das Abspielen ab (Stromsparen), startet der Klick auf „Abspielen“ direkt in der Geste", async () => {
  const play = vi.fn()
    .mockImplementationOnce(() => Promise.reject(new Error("NotAllowedError")))
    .mockImplementation(function play() {
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
  window.HTMLMediaElement.prototype.play = play;
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  await act(async () => {});
  const button = screen.getByTestId(`help-step-clip-toggle-${SCHRITT.id}`);
  expect(play).toHaveBeenCalledTimes(1);
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ abspielen`);
  fireEvent.click(button);
  expect(play).toHaveBeenCalledTimes(2);
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ anhalten`);
});

test("iOS: stumm auch als Attribut und Vorgabe gesetzt", () => {
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  const video = screen.getByTestId(`help-step-clip-${SCHRITT.id}`);
  expect(video).toHaveAttribute("muted");
  expect(video.defaultMuted).toBe(true);
});

test("„Bewegung reduzieren“: nur das Bild mit Knopf „Abspielen“, die Schleife erst auf Wunsch", () => {
  setMedia({ reduce: true });
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  expect(screen.queryByTestId(`help-step-clip-${SCHRITT.id}`)).toBeNull();
  expect(screen.getByTestId(`help-step-image-${SCHRITT.id}`)).toBeInTheDocument();
  const button = screen.getByRole("button", { name: `Animation „${SCHRITT.titel}“ abspielen` });
  expect(button).toHaveTextContent("Abspielen");
  expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toBeInTheDocument();
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
  expect(button).toHaveAccessibleName(`Animation „${SCHRITT.titel}“ anhalten`);
});

test("Rückfall: Schritt ohne Schleife zeigt das Bild ohne Knopf; bricht das Video ab, bleibt das Bild", () => {
  setMedia();
  const { unmount } = render(<FaqClip slug={SLUG} schritt={OHNE_CLIP} />);
  scrollInto(true);
  expect(screen.getByTestId(`help-step-image-${OHNE_CLIP.id}`)).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
  unmount();

  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  scrollInto(true);
  // Erst WebM, bei Abbruch MP4, erst dann das Bild.
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("src", hilfeClip(SLUG, SCHRITT.id, "pc").webm);
  fireEvent.error(screen.getByTestId(`help-step-clip-${SCHRITT.id}`));
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toHaveAttribute("src", hilfeClip(SLUG, SCHRITT.id, "pc").mp4);
  expect(screen.getByTestId(`help-step-clip-toggle-${SCHRITT.id}`)).toBeInTheDocument();
  fireEvent.error(screen.getByTestId(`help-step-clip-${SCHRITT.id}`));
  expect(screen.queryByTestId(`help-step-clip-${SCHRITT.id}`)).toBeNull();
  expect(screen.getByTestId(`help-step-image-${SCHRITT.id}`)).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});

test("ohne IntersectionObserver (sehr alte Browser) bleibt es beim Bild, „Abspielen“ startet trotzdem", () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  setMedia();
  render(<FaqClip slug={SLUG} schritt={SCHRITT} />);
  expect(screen.getByTestId(`help-step-image-${SCHRITT.id}`)).toBeInTheDocument();
  expect(screen.queryByTestId(`help-step-clip-${SCHRITT.id}`)).toBeNull();
  expect(window.HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId(`help-step-clip-toggle-${SCHRITT.id}`));
  expect(screen.getByTestId(`help-step-clip-${SCHRITT.id}`)).toBeInTheDocument();
  expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();
});
