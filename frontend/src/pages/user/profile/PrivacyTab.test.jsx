import { fireEvent, render, screen } from "@testing-library/react";

// Privatsphäre (#619): der Schalter „Erfolge öffentlich“ steht direkt unter „Öffentliches Profil“,
// ist ohne gespeicherten Wert an und schreibt das Feld über set().

const { PrivacyTab } = await import("./PrivacyTab");

function renderTab(form = {}) {
  const set = vi.fn();
  render(
    <PrivacyTab
      form={{ privacy_public_profile: true, profile_visibility: {}, dm_privacy: "everyone", ...form }}
      set={set}
      setVisibility={() => {}}
      setVisibilityGroup={() => {}}
      autosave={{ status: "idle", message: "" }}
    />,
  );
  return set;
}

describe("PrivacyTab – Erfolge öffentlich", () => {
  it("ist ohne Wert an und schaltet über set()", () => {
    const set = renderTab();
    const toggle = screen.getByTestId("profile-privacy-achievements");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_achievements_public", false);
  });

  it("zeigt den gespeicherten Wert und den Hinweis bei privatem Profil", () => {
    renderTab({ privacy_achievements_public: false, privacy_public_profile: false });
    expect(screen.getByTestId("profile-privacy-achievements")).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Wirkt erst, sobald das Profil öffentlich ist.")).toBeInTheDocument();
  });
});
