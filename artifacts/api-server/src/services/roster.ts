// Canonical machine master for the CP Pipe & Fitting plant.
// Pipe M/C-1..9 → PIPE-N
// Moulding A01-A06, B01-B06, C01-C07, D01-D07 → MOULD-XNN
//
// This module is the SINGLE source of truth for canonical keys.  All parsers
// must call toCanonicalKey() — never pattern-match raw strings themselves.

export const PIPE_CANONICAL = [
  "PIPE-1",
  "PIPE-2",
  "PIPE-3",
  "PIPE-4",
  "PIPE-5",
  "PIPE-6",
  "PIPE-7",
  "PIPE-8",
  "PIPE-9",
];

export const MOULD_CANONICAL = [
  "MOULD-A01",
  "MOULD-A02",
  "MOULD-A03",
  "MOULD-A04",
  "MOULD-A05",
  "MOULD-A06",
  "MOULD-B01",
  "MOULD-B02",
  "MOULD-B03",
  "MOULD-B04",
  "MOULD-B05",
  "MOULD-B06",
  "MOULD-C01",
  "MOULD-C02",
  "MOULD-C03",
  "MOULD-C04",
  "MOULD-C05",
  "MOULD-C06",
  "MOULD-C07",
  "MOULD-D01",
  "MOULD-D02",
  "MOULD-D03",
  "MOULD-D04",
  "MOULD-D05",
  "MOULD-D06",
  "MOULD-D07",
];

// Maps a raw machine string (from any report or roster) to its canonical key.
// Returns null if the string is not a recognised pipe or moulding machine.
export function toCanonicalKey(raw: string): string | null {
  const s = raw.trim();

  // Pipe: "Pipe M/C-1", "PIPE M/C - 1", "Pipe M/C 1", etc.
  const pipeMatch = s.match(/(?:pipe|PIPE)[\s]?m\/c[\s\-]+(\d+)/i);
  if (pipeMatch) return `PIPE-${parseInt(pipeMatch[1]!, 10)}`;

  // Moulding: "A02(U-150)", "A01(NU-200)", "B07(NU-350)", bare "A02", etc.
  // Must start with exactly one letter A-D followed by exactly two digits.
  const mouldMatch = s.match(/^([A-Da-d])(\d{2})/);
  if (mouldMatch) return `MOULD-${mouldMatch[1]!.toUpperCase()}${mouldMatch[2]}`;

  return null;
}

export function isPipeKey(key: string): boolean {
  return key.startsWith("PIPE-");
}

export function isMouldKey(key: string): boolean {
  return key.startsWith("MOULD-");
}

// Per-month PIPE daily workbook file IDs (Apr-2025 – Jun-2026).
// Update this map when new monthly workbooks are created.
export const PIPE_DAILY_WORKBOOKS: Record<string, string> = {
  "2025-04": "10GHWEV7pY_qcpFLmXqKwwDtmidAjL6FG0MOtAwUJ484",
  "2025-05": "13cC3moR19el7Q3pYYNq08P5YXXZBh_lbgxGt9yagrRQ",
  "2025-06": "1xkWuDcyTegPJCOAzOMdIzBl75xzhXUm2MwXO5TZdkgg",
  "2025-07": "1zE3D83XSgTE-Z4tuLvwP1bQfnPzEjefqrTOJ7vexix8",
  "2025-08": "1zVCB6taXefFOR6U3tJh5QjokQCtt9wTJBitQxm0-w2w", // empty/awaiting source
  "2025-09": "1ATjAaTkoqf3Bz5BHYXdb8fzgc1ah0RDz5L_07KIGdTI",
  "2025-10": "1zzaNoN1F9LC7FX3FAI2PKMR5Y35MT94hqSBXPoTcMZw",
  "2025-11": "1oYDIFrPYJ9BhLS35Ss4RUNFUz1gJW5Dsl76uJL_omX8",
  "2025-12": "1wyMZVW8q0AxSjOS0JKAPLtf4eV57_K_h47t9VwwlTko",
  "2026-01": "1vaj-Ex3rgWV6QA4VQlgIhOubMyagWv1XeoHBvTS6bU8",
  "2026-02": "1cdrzhx5hYwU8dLo0AT65YWy66J8SmtF_vKRgzPK2UAI",
  "2026-03": "1waJo0TZivjwg-JLPdV_JXaBH4oBiP16CqY_Wme5l0ns",
  "2026-04": "1eNUSktOldFHRtM55VYfLiYp5nLDRk3ovOEdYYKfI0hU",
  "2026-05": "17__f7pP28bIoctVXV-iku3WIlffAuonvRhCaViVu-bA",
  "2026-06": "1uwuhCylN3h9HizK5qNUCH-sjktE3GEH74Y_UeNq6eec",
};
