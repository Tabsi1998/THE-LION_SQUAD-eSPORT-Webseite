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
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatAdminDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE");
}
