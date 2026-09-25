import { render, screen } from "@testing-library/react";
import { DiscordMessagePreview, embedColor, renderDiscordText } from "./DiscordMessagePreview";

// Discord-Nachbildung (#583): Bot-Name mit BOT-Plakette, Farbleiste, Titel als Link, Fettschrift im
// Text, Felder, Bild und Fußzeile - alles aus dem Embed, das der Server auch wirklich schickt.

test("die Farbe des Embeds wird zu einer CSS-Farbe", () => {
  expect(embedColor(0x29b6e8)).toBe("#29b6e8");
  expect(embedColor(255)).toBe("#0000ff");
  expect(embedColor(undefined)).toBe("#29b6e8");
});

test("Fettschrift und Zeilenumbrüche wie im Discord", () => {
  render(<div data-testid="text">{renderDiscordText("**Paula** führt\nauf **Spa**!")}</div>);
  const text = screen.getByTestId("text");
  expect(text.querySelectorAll("strong")).toHaveLength(2);
  expect(text.querySelector("br")).not.toBeNull();
  expect(text).toHaveTextContent("Paula führt");
  expect(text).toHaveTextContent("auf Spa!");
});

test("Titel, Felder, Bild und Fußzeile stehen im Kasten; der Titel ist ein Link, wenn es einen gibt", () => {
  render(
    <DiscordMessagePreview
      botName="LION Bot"
      testId="msg"
      embed={{
        title: "🏆 Sommer-Cup · Jetzt live", description: "Zwei Tage zocken.", color: 0x00ff88, url: "https://lionsquad.at/tournaments/sommer-cup",
        fields: [{ name: "Spiel", value: "Rocket League", inline: true }, { name: "Hinweis", value: "Ganze Breite", inline: false }],
        image: { url: "https://lionsquad.at/api/static/uploads/public/cup.webp" }, footer: { text: "Test · nicht an die Community" },
      }}
    />,
  );
  const message = screen.getByTestId("msg");
  expect(message).toHaveTextContent("LION Bot");
  expect(message).toHaveTextContent("BOT");
  const embed = screen.getByTestId("msg-embed");
  expect(embed).toHaveStyle({ borderLeftColor: "#00ff88" });
  expect(embed.querySelector("a")).toHaveAttribute("href", "https://lionsquad.at/tournaments/sommer-cup");
  expect(embed).toHaveTextContent("Rocket League");
  expect(embed.querySelector("img")).toHaveAttribute("src", expect.stringContaining("cup.webp"));
  expect(embed).toHaveTextContent("Test · nicht an die Community");
  expect(screen.getByText("Ganze Breite").parentElement).toHaveClass("sm:col-span-3");
});

test("ohne Link ist der Titel nur Text", () => {
  render(<DiscordMessagePreview embed={{ title: "📝 Neuer Mitgliedsantrag", color: 0xffd700 }} embedTestId="custom-embed" />);
  const embed = screen.getByTestId("custom-embed");
  expect(embed.querySelector("a")).toBeNull();
  expect(embed).toHaveTextContent("Neuer Mitgliedsantrag");
});
