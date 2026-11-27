import { render } from "@testing-library/react";

// Was in der Nische eines geöffneten Türchens steht (#641, #1302): der Titel ab 12 px, nie abgeschnitten und nie mit
// „…“. Passt er nicht in die Nische, steht dort die kurze Art des Türchens („Gruß“, „Quiz“); passt auch die nicht, nur
// das Zeichen - der ganze Titel steht im Fenster.

vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { NichePreview } = await import("./Door");

// jsdom misst nichts: Der Titel „passt“, solange er höchstens `room` Zeichen hat (ohne Zeichen darüber `roomAlone`) -
// sonst ist er höher als seine Fläche.
let room = Infinity;
let roomAlone = Infinity;
const scrollHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
const clientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

beforeEach(() => {
  room = Infinity;
  roomAlone = Infinity;
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      if (!this.classList.contains("tls-adv__preview-title")) return 20;
      const limit = this.parentElement.querySelector(".tls-adv__preview-icon") ? room : roomAlone;
      return this.textContent.length > limit ? 60 : 20;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 20 });
});

afterEach(() => {
  if (scrollHeight) Object.defineProperty(HTMLElement.prototype, "scrollHeight", scrollHeight);
  else delete HTMLElement.prototype.scrollHeight;
  if (clientHeight) Object.defineProperty(HTMLElement.prototype, "clientHeight", clientHeight);
  else delete HTMLElement.prototype.clientHeight;
});

const title = (container) => container.querySelector(".tls-adv__preview-title");

test("ein Titel, der passt, steht ganz in der Nische", () => {
  room = 20;
  const { container } = render(<NichePreview content={{ kind: "quiz", title: "Kranz-Quiz" }} />);
  expect(title(container)).toHaveTextContent(/^Kranz-Quiz$/);
});

test("passt der Titel nur ohne das Zeichen darüber, bekommt er dessen Platz - eine Zeile mehr", () => {
  room = 20;
  roomAlone = 40;
  const { container } = render(<NichePreview content={{ kind: "text", title: "Das Team beim Saisonfinale in Wörgl" }} />);
  expect(title(container)).toHaveTextContent(/^Das Team beim Saisonfinale in Wörgl$/);
  expect(container.querySelector(".tls-adv__preview-icon")).toBeNull();
  expect(container.querySelector(".tls-adv__preview")).toHaveAttribute("data-fit", "text");
});

test("ein Titel, der nicht passt, weicht auf die Art aus - nicht abgeschnitten, kein „…“", () => {
  room = 20;
  roomAlone = 30;
  const long = "Ein ziemlich langer Titel für das heutige Türchen im Advent";
  const { container } = render(<NichePreview content={{ kind: "text", title: long }} />);
  expect(title(container)).toHaveTextContent(/^Gruß$/);
  expect(container.textContent).not.toContain("…");
  expect(container.querySelector(".tls-adv__preview")).toHaveAttribute("data-fit", "kind");
});

test("passt auch die Art nicht, bleibt nur das Zeichen", () => {
  room = 3;
  roomAlone = 3;
  const { container } = render(<NichePreview content={{ kind: "member_spotlight", title: "Mitglied der Woche: NeonFalke" }} />);
  expect(title(container)).toBeNull();
  expect(container.querySelector(".tls-adv__preview-icon")).not.toBeNull();
  expect(container.querySelector(".tls-adv__preview")).toHaveAttribute("data-fit", "none");
});
