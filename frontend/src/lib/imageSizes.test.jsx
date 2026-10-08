import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fireEvent, render } from "@testing-library/react";
import { LazyImg } from "@/components/tls/LazyImg";
import { SizedImage, PROFILE_IMAGE_SIZES } from "@/components/tls/SizedImage";

// Bilder in passender Größe (#1227): ohne `sizes` nimmt der Browser „volle Bildschirmbreite“ an und lädt für ein
// 40-Pixel-Bild eine große Fassung. Der Wächter meldet jede LazyImg-Stelle ohne `sizes` und jedes SizedImage ohne
// Größe. Seiten aus anderen Meilensteinen übernehmen das, wenn sie ohnehin angefasst werden - sie stehen hier mit
// ihrer Zahl und dürfen nur weniger werden.

const root = path.resolve(__dirname, "..");
const LATER = {
  "pages/public/AboutPage.jsx": 3, // Über uns - übernimmt den Baustein mit dem Meilenstein „Verein und Mitgliederbereich“
};

function filesIn(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesIn(full);
    return /\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name) ? [full] : [];
  });
}

function elements(source, tag) {
  return [...source.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g"))].map((match) => match[0]);
}

test("jede LazyImg-Stelle sagt, wie breit das Bild gezeigt wird; jedes SizedImage hat eine Größe", () => {
  const found = {};
  for (const file of filesIn(root)) {
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const source = readFileSync(file, "utf8");
    const missing = elements(source, "LazyImg").filter((tag) => !/\ssizes=/.test(tag)).length
      + elements(source, "SizedImage").filter((tag) => !/\s(size|width|sizes)=/.test(tag)).length;
    if (missing) found[rel] = missing;
  }
  for (const [rel, count] of Object.entries(found)) {
    expect(count, `${rel}: Bild ohne sizes bzw. Größe`).toBeLessThanOrEqual(LATER[rel] || 0);
  }
  // Die Liste schrumpft: ist eine Seite erledigt, fliegt sie hier raus.
  for (const [rel, count] of Object.entries(LATER)) {
    expect(found[rel] || 0, `${rel} ist erledigt - bitte aus LATER streichen`).toBe(count);
  }
});

test("ein Profilbild bekommt nur die kleinen Fassungen angeboten, in jeder der fünf Größen", () => {
  for (const size of PROFILE_IMAGE_SIZES) {
    const { container, unmount } = render(<SizedImage src="/api/static/uploads/avatar.png" size={size} round alt="" />);
    const img = container.querySelector("img");
    expect(img.getAttribute("sizes")).toBe(`${size}px`);
    expect(img.getAttribute("width")).toBe(String(size));
    expect(img.className).toContain("rounded-full");
    const offered = img.getAttribute("srcset").split(", ").map((entry) => Number(entry.split(" ")[1].replace("w", "")));
    expect(offered).toEqual(size <= 48 ? [160] : [160, 320]);
    expect(img.getAttribute("loading")).toBe("lazy");
    unmount();
  }
});

test("ohne Bild oder wenn es nicht lädt, steht der Ersatz da", () => {
  const { getByTestId, container, rerender } = render(<SizedImage src="" size={40} fallback={<span data-testid="ersatz">AB</span>} />);
  expect(getByTestId("ersatz")).toHaveTextContent("AB");
  rerender(<SizedImage src="/api/static/uploads/kaputt.png" size={40} fallback={<span data-testid="ersatz">AB</span>} />);
  fireEvent.error(container.querySelector("img"));
  expect(getByTestId("ersatz")).toBeInTheDocument();
});

test("LazyImg warnt beim Entwickeln, wenn sizes fehlt", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  render(<LazyImg src="/api/static/uploads/banner.webp" alt="" />);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("„sizes“ fehlt"));
  warn.mockClear();
  render(<LazyImg src="/api/static/uploads/banner.webp" alt="" sizes="50vw" />);
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
