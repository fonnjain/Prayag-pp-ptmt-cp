import * as XLSX from "xlsx";

export const PENDING_FIXTURE_HEADERS = [
  "Order Date",
  "Invoice No.",
  "Customer",
  "Item Code",
  "Item Name",
  "Colour",
  "Segment",
  "Balance_Qty",
  "Quantity",
  "Unit",
  "Rate",
  "Value",
  "Sales Person",
  "Region",
  "State",
  "City",
  "Plant",
  "Status",
  "Due Date",
  "Remarks",
  "PO No.",
  "Customer Code",
  "Warehouse",
  "Created By",
  "Updated At",
] as const;

type PendingFixtureRow = {
  code: string;
  colour: string;
  segment: "PTMT" | "Plumbing";
  balance: number;
};

const FIXTURE_ROWS: PendingFixtureRow[] = [
  { code: "PT-ANON-001", colour: "WHITE", segment: "PTMT", balance: 2_500 },
  { code: "PT-ANON-002", colour: "BLUE", segment: "PTMT", balance: 2_090 },
  { code: "PL-ANON-001", colour: "GREY", segment: "Plumbing", balance: 4_000 },
  { code: "PL-ANON-002", colour: "WHITE", segment: "Plumbing", balance: 1_710 },
];

function pendingSheetRows(rows: PendingFixtureRow[]): unknown[][] {
  return [
    ["Anonymised pending-order fixture"],
    [...PENDING_FIXTURE_HEADERS],
    ...rows.map((row) => [
      "2026-07-01",
      "ANON-PO",
      "Anonymised customer",
      row.code,
      "Anonymised item",
      row.colour,
      row.segment,
      row.balance,
      row.balance,
      "PCS",
      null,
      null,
      null,
      null,
      null,
      null,
      "ANON-PLANT",
      "Open",
      "2026-07-31",
      null,
      "ANON-PO",
      "ANON-CUSTOMER",
      "ANON-WH",
      "ANON",
      "2026-07-01",
    ]),
  ];
}

function invoiceRegisterRows(): unknown[][] {
  return [
    ["Invoice register; deliberately not a pending balance sheet"],
    ["Item Code", "Item Name", "Colour", "Segment", "Quantity", "Invoice Date"],
    ["INVOICE-ONLY", "Anonymised item", "WHITE", "PTMT", 999_999, "2026-07-01"],
  ];
}

export function buildPendingFixtureWorkbook(
  pendingSheetName: string,
  options: { includeNamedDecoy?: boolean } = {},
): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(invoiceRegisterRows()),
    "Invoice Register",
  );
  if (options.includeNamedDecoy) {
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Named decoy without an open-balance field"],
        ["Item Code", "Colour", "Segment", "Quantity"],
        ["DECOY-ONLY", "WHITE", "PTMT", 123_456],
      ]),
      "Pending Summary",
    );
  }
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(pendingSheetRows(FIXTURE_ROWS)),
    pendingSheetName,
  );
  return workbook;
}

export function buildUnrecognisedPendingFixtureWorkbook(): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(invoiceRegisterRows()),
    "Invoice Register",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["Renamed pending tab without a recognised balance column"],
      ["Item Code", "Colour", "Segment", "Quantity"],
      ["OPEN-ORDER-ONLY", "WHITE", "PTMT", 456_789],
    ]),
    "Open Orders July",
  );
  return workbook;
}

export function serialisePendingFixture(workbook: XLSX.WorkBook): Buffer {
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
