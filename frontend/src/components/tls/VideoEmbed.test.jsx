import { render, screen } from "@testing-library/react";

// Video auf der News-Seite (#578): der Player erst nach Zustimmung, davor der Hinweis mit Link.

const consent = { value: false };
vi.mock("@/components/tls/CookieConsent", () => ({ useCookieConsent: () => ({ hasConsent: () => consent.value }) }));
vi.mock("@/components/tls/ExternalMediaNotice", () => ({ ExternalMediaNotice: ({ service, url, testId }) => <div data-testid={testId}>{service} {url}</div> }));

const { VideoEmbed, youtubeVideoId } = await import("./VideoEmbed");

test("Video-ID aus allen YouTube-Adressen, sonst leer", () => {
  expect(youtubeVideoId("https://www.youtube.com/watch?v=abcdefghijk")).toBe("abcdefghijk");
  expect(youtubeVideoId("https://youtu.be/abcdefghijk")).toBe("abcdefghijk");
  expect(youtubeVideoId("https://www.youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
  expect(youtubeVideoId("https://example.com/watch?v=abcdefghijk")).toBe("");
  expect(youtubeVideoId("")).toBe("");
});

test("ohne Zustimmung der Hinweis, mit Zustimmung der Player über youtube-nocookie", () => {
  consent.value = false;
  const { rerender, container } = render(<VideoEmbed url="https://www.youtube.com/watch?v=abcdefghijk" title="Finale" />);
  expect(screen.getByTestId("video-consent-notice")).toHaveTextContent("YouTube https://www.youtube.com/watch?v=abcdefghijk");
  expect(screen.queryByTestId("video-embed-frame")).toBeNull();
  expect(screen.getByTestId("video-embed-external")).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk");

  consent.value = true;
  rerender(<VideoEmbed url="https://youtu.be/abcdefghijk" title="Finale" />);
  expect(screen.getByTestId("video-embed-frame")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0");
  expect(screen.getByTestId("video-embed-frame")).toHaveAttribute("title", "Finale");

  rerender(<VideoEmbed url="https://example.com/x" />);
  expect(container.querySelector("[data-testid='video-embed']")).toBeNull();
});
