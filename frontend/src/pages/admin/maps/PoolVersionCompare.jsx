// Zwei Versionen eines Map-Pools vergleichen (#2207): je Modus, was dazukam und was wegfiel. Eigenständig - braucht nur die
// Adresse des Pools (`baseUrl`, z. B. /admin/leagues/seasons/<id>/map-pool) und lädt neu, wenn sich `version` ändert.
import { useEffect, useState } from "react";
import { GitCompare } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { SelectField } from "@/components/tls/FormFields";
import { viennaDate } from "@/lib/vienna";
import { compareRows } from "@/lib/seasonPools";

const DAY = { day: "2-digit", month: "2-digit", year: "numeric" };

function versionLabel(row) {
  const day = row.saved_at ? ` · ${viennaDate(row.saved_at, DAY)}` : "";
  return `Version ${row.version}${day}${row.cleared ? " · entfernt" : ` · ${row.maps} Maps`}`;
}

export function PoolVersionCompare({ baseUrl, version, testId = "pool-compare" }) {
  const [versions, setVersions] = useState([]);
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [diff, setDiff] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`${baseUrl}/versions`).then(({ data }) => {
      if (!alive) return;
      const rows = data.versions || [];
      setVersions(rows);
      setTarget(rows[0] ? String(rows[0].version) : "");
      setBase(rows[1] ? String(rows[1].version) : "");
      setDiff(null);
    }).catch((err) => { if (alive) setError(formatApiError(err.response?.data?.detail)); });
    return () => { alive = false; };
  }, [baseUrl, version]);

  if (versions.length < 2) return null;
  const options = versions.map((row) => [String(row.version), versionLabel(row)]);
  const run = async () => {
    try {
      const { data } = await api.get(`${baseUrl}/compare`, { params: { base, target } });
      setDiff(data);
      setError("");
    } catch (err) {
      setError(formatApiError(err.response?.data?.detail));
    }
  };
  const rows = compareRows(diff);
  return (
    <details className="group rounded-sm border border-white/10 bg-[#121212] p-4" data-testid={testId}>
      <summary className="cursor-pointer select-none text-xs font-bold uppercase tracking-widest text-white/70 hover:text-white focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm">
        Versionen vergleichen
      </summary>
      <div className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <SelectField label="Von Version" value={base} onChange={setBase} options={options} testId={`${testId}-base`} />
          <SelectField label="Zu Version" value={target} onChange={setTarget} options={options} testId={`${testId}-target`} />
          <button type="button" onClick={run} disabled={!base || !target} data-testid={`${testId}-run`}
            className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
            <GitCompare className="w-3.5 h-3.5" aria-hidden="true" /> Vergleichen
          </button>
        </div>
        {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
        {diff ? (
          diff.same ? <p className="text-sm text-white/60" data-testid={`${testId}-same`}>Beide Versionen haben dieselben Maps.</p> : (
            <ul className="space-y-2" data-testid={`${testId}-result`} aria-live="polite">
              {rows.map((row) => (
                <li key={row.key} className="rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm" data-testid={`${testId}-mode-${row.key}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-white">{row.label}</span>
                    <span className="text-xs text-white/55">{row.statusText}{row.kept ? ` · ${row.kept} geblieben` : ""}</span>
                  </div>
                  {row.added.length ? <div className="text-xs text-[#29B6E8]">Hinzu: {row.added.join(", ")}</div> : null}
                  {row.removed.length ? <div className="text-xs text-warn">Weg: {row.removed.join(", ")}</div> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </details>
  );
}
