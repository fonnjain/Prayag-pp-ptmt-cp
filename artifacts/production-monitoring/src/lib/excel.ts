import * as XLSX from "xlsx";

export type SheetRow = Record<string, unknown>;

export function exportXlsx(filename: string, sheets: { name: string; rows: SheetRow[] }[]) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
