// Was beim Laden schiefging (#1152, wie loadProblem in der App): ohne Netz, nicht gefunden (404), nicht freigegeben
// (401/403) oder ein anderer Fehler. Danach richtet sich, was eine Seite zeigt - ein Ladefehler ist nie „nichts da“.

export function problemKind(error) {
  if (!error || !error.response) return "offline";
  const status = error.response.status;
  if (status === 404) return "notFound";
  if (status === 401 || status === 403) return "denied";
  return "error";
}
