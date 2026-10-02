// Die Uhr des Servers (S9 #640, N3 #741): Countdown und Show richten sich nach dem Server, nicht nach der Uhr des
// Geräts (die kann Minuten danebenliegen). Die Saison-Abfrage bringt `now` mit; daraus wird der Abstand zur Geräteuhr.

/**
 * Der Abstand der Serveruhr zur Geräteuhr (ms): Zeitpunkt der Antwort gegen die Mitte zwischen Anfrage und Antwort -
 * so zählt die halbe Laufzeit nicht als Abweichung. Ohne gültige Zeit: 0.
 */
export function serverOffset(serverNowIso, requestedAt, receivedAt) {
  const server = Date.parse(serverNowIso || "");
  if (!Number.isFinite(server) || !Number.isFinite(requestedAt) || !Number.isFinite(receivedAt)) return 0;
  return Math.round(server - (requestedAt + receivedAt) / 2);
}

/** Die Serverzeit jetzt (ms) aus dem Abstand. */
export function serverNow(offset = 0, now = Date.now()) {
  return now + (Number(offset) || 0);
}
