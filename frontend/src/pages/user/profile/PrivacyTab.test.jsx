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
    // Der Hinweis steht an den drei Schaltern, die am öffentlichen Profil hängen (Erfolge, vereinsinterne Erfolge #2516,
    // Saison-Fundstücke).
    expect(screen.getAllByText("Wirkt erst, sobald das Profil öffentlich ist.")).toHaveLength(3);
  });

  it("Vereinsinterne Erfolge zeigen (#2516): ohne Wert an, mit Erklärung, steht bei den Erfolgen", () => {
    const set = renderTab();
    const toggle = screen.getByTestId("profile-privacy-internal");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Vereinsinterne Erfolge zeigen")).toBeInTheDocument();
    expect(screen.getByText(/Mitglieder sehen auch deine vereinsinternen Turniere und Zeiten\. Öffentlich sind sie nie zu sehen\./)).toBeInTheDocument();
    // Eingeordnet direkt nach „Erfolge öffentlich“, nicht unten angehängt.
    const switches = screen.getAllByRole("switch").map((node) => node.getAttribute("data-testid"));
    expect(switches.indexOf("profile-privacy-internal")).toBe(switches.indexOf("profile-privacy-achievements") + 1);
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_members_see_internal", false);
  });

  it("Vereinsinterne Erfolge zeigen: ein gespeichertes Aus bleibt aus und schaltet wieder an", () => {
    const set = renderTab({ privacy_members_see_internal: false });
    const toggle = screen.getByTestId("profile-privacy-internal");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_members_see_internal", true);
  });

  it("Saison-Fundstücke öffentlich (#678): Vorgabe aus, Umschalten speichert", () => {
    const set = renderTab({ privacy_public_profile: true });
    const toggle = screen.getByTestId("profile-privacy-season-finds");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_season_finds_public", true);
  });
});

describe("PrivacyTab – Direktnachrichten (#2126)", () => {
  it("sagt ehrlich, dass die Moderation trotzdem schreiben kann", () => {
    renderTab();
    expect(screen.getByRole("option", { name: "Nur Moderation und Admins" })).toHaveValue("admins_only");
    expect(screen.getByRole("option", { name: "Niemand außer der Moderation" })).toHaveValue("none");
    expect(screen.getByText(/Die Moderation erreicht dich immer/)).toBeInTheDocument();
  });
});

describe("PrivacyTab – Freunde sehen, wo ich angemeldet bin (#1188)", () => {
  it("zeigt den wirksamen Stand und speichert beim Umschalten", () => {
    const set = renderTab({ privacy_friends_see_registrations: true });
    const toggle = screen.getByTestId("profile-privacy-friends-registrations");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_friends_see_registrations", false);
  });

  it("aus (etwa unter 14 Jahren) bleibt aus, bis die Person es einschaltet", () => {
    const set = renderTab({ privacy_friends_see_registrations: false });
    const toggle = screen.getByTestId("profile-privacy-friends-registrations");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    fireEvent.click(toggle);
    expect(set).toHaveBeenCalledWith("privacy_friends_see_registrations", true);
  });
});
