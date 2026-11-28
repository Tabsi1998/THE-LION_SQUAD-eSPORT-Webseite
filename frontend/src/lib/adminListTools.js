import { formatOfficialDate } from "@/lib/datetime";
export function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function csvCell(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ");
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function downloadCsv(filename, header, rows) {
  const lines = [
    header.map(csvCell).join(";"),
    ...rows.map((row) => row.map(csvCell).join(";")),
  ];
  // Mit BOM vorne, damit Excel Umlaute („Plätze“) als UTF-8 liest (#1373).
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Datum für CSV-Spalten: amtlich „14.03.2026“ (#1307) - sortierbar, mit Jahr, nie „morgen“. Nur für Ausfuhren. */
export function formatAdminDate(value) {
  return value ? formatOfficialDate(value) : "";
}
