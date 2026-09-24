import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { buildDirtyPayload, hasPayloadChanges } from "@/lib/dirtyPayload";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { TwitchTab } from "./TwitchTab";

// Twitch: Vereinskanal, Helix-App (Client ID + Secret), Live-Erkennung und der Stand der Abfrage.
// Bis 24.09. ein Reiter der Einstellungen; seit „muss das doppelt sein?“ nur noch auf der Twitch-
// Seite unter Verbindungen. Das Secret geht nur mit, wenn neu eingetippt.

const EMPTY_BRAND = { twitch_channel: "", twitch_client_id: "", twitch_client_secret: "", twitch_client_secret_masked: "", twitch_live_detection: true };

export function twitchPayload(brand) {
  const payload = {
    twitch_channel: brand.twitch_channel || "",
    twitch_client_id: brand.twitch_client_id || "",
    twitch_live_detection: brand.twitch_live_detection !== false,
  };
  if (brand.twitch_client_secret) payload.twitch_client_secret = brand.twitch_client_secret;
  return payload;
}

export function TwitchSettings() {
  const confirm = useConfirm();
  const [brand, setBrand] = useState(EMPTY_BRAND);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const dirtyRef = useRef(false);
  const originalRef = useRef({});

  const load = useCallback(async () => {
    const [branding, streams] = await Promise.allSettled([api.get("/settings/branding"), api.get("/admin/streams/status")]);
    if (branding.status === "fulfilled" && branding.value.data && !dirtyRef.current) {
      const data = branding.value.data;
      setBrand((prev) => {
        const next = {
          ...prev,
          twitch_channel: data.twitch_channel || "",
          twitch_client_id: data.twitch_client_id || "",
          twitch_client_secret: "",
          twitch_client_secret_masked: data.twitch_client_secret_masked || "",
          twitch_live_detection: data.twitch_live_detection !== false,
        };
        originalRef.current = twitchPayload(next);
        return next;
      });
    }
    if (streams.status === "fulfilled" && streams.value.data) setStatus(streams.value.data);
  }, []);
  useEffect(() => { load(); }, [load]);
  // Der Stand der Abfrage ändert sich ohne Klick: ohne Strom alle 15 s nachfragen.
  useLiveRefresh(load, ["settings", "users"], { fallbackMs: 15000 });

  const setBrandField = (key, value) => {
    dirtyRef.current = true;
    setBrand((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    if (saving) return;
    const patch = buildDirtyPayload(twitchPayload(brand), originalRef.current);
    if (!hasPayloadChanges(patch)) {
      toast.info("Keine Änderungen zum Speichern.");
      return;
    }
    setSaving(true);
    try {
      await api.put("/settings/branding", patch);
      dirtyRef.current = false;
      toast.success("Twitch-Einstellungen gespeichert.");
      await load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setSaving(false); }
  };
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const { data } = await api.post("/admin/streams/refresh");
      if (data?.ok) toast.success(`Twitch geprüft: ${data.live || 0} live von ${data.checked || 0} Kanälen.`);
      else toast.error(`Twitch nicht geprüft: ${data?.skipped || "unbekannt"}`);
      await load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
    finally { setRefreshing(false); }
  };
  const clearSecret = async () => {
    if (!await confirm({ title: "Twitch Secret entfernen?", description: "Client Secret und zwischengespeicherter Twitch-Token werden entfernt.", confirmLabel: "Secret entfernen" })) return;
    try {
      await api.put("/settings/branding", { clear_twitch_client_secret: true });
      dirtyRef.current = false;
      toast.success("Twitch Secret entfernt.");
      await load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <div data-testid="twitch-settings">
      <TwitchTab brand={brand} setBrandField={setBrandField} status={status} saving={saving} refreshing={refreshing} onSave={save} onRefresh={refresh} onClearSecret={clearSecret} />
    </div>
  );
}
