import type { FrozenPlanRow } from "./excel-export";
import { launchBrowser } from "./browser";
import { assertWeeklyProductionConservation } from "./weekly-excel-export";

const WEEK_COLORS: Record<string, string> = {
  W1: "#fce5cd",
  W2: "#fff2cc",
  W3: "#d9ead3",
  W4: "#cfe2f3",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function weekLabel(week: number | null): string {
  return week && [1, 2, 3, 4].includes(week) ? `W${week}` : "—";
}

function buildWeeklyPdfHtml(
  month: string,
  rows: FrozenPlanRow[],
  sourceDescription: string,
  segment: string,
): string {
  const byCategory = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const categoryRows = byCategory.get(row.category) ?? [];
    categoryRows.push(row);
    byCategory.set(row.category, categoryRows);
  }

  const totals = (categoryRows: FrozenPlanRow[]) => ({
    w1: categoryRows.reduce((sum, row) => sum + row.w1, 0),
    w2: categoryRows.reduce((sum, row) => sum + row.w2, 0),
    w3: categoryRows.reduce((sum, row) => sum + row.w3, 0),
    w4: categoryRows.reduce((sum, row) => sum + row.w4, 0),
    productionPlan: categoryRows.reduce((sum, row) => sum + Math.max(0, row.productionPlan), 0),
    cannotBeMade: categoryRows.reduce((sum, row) => sum + Math.max(0, row.cannotBeMade), 0),
  });

  const categoryTotals = [...byCategory.entries()].map(([category, categoryRows]) => ({
    category,
    ...totals(categoryRows),
  }));

  const summaryRows = categoryTotals.map((row) => {
    const weeklyTotal = row.w1 + row.w2 + row.w3 + row.w4;
    const pass = Math.abs(weeklyTotal - row.productionPlan) <= 0.001;
    return `<tr>
      <td class="left">${escapeHtml(row.category)}</td>
      <td>${formatNumber(row.w1)}</td>
      <td>${formatNumber(row.w2)}</td>
      <td>${formatNumber(row.w3)}</td>
      <td>${formatNumber(row.w4)}</td>
      <td>${formatNumber(row.productionPlan)}</td>
      <td>${formatNumber(row.cannotBeMade)}</td>
      <td class="${pass ? "pass" : "fail"}">${pass ? "PASS" : "FAIL"}</td>
    </tr>`;
  }).join("");

  const grand = categoryTotals.reduce(
    (sum, row) => ({
      w1: sum.w1 + row.w1,
      w2: sum.w2 + row.w2,
      w3: sum.w3 + row.w3,
      w4: sum.w4 + row.w4,
      productionPlan: sum.productionPlan + row.productionPlan,
      cannotBeMade: sum.cannotBeMade + row.cannotBeMade,
    }),
    { w1: 0, w2: 0, w3: 0, w4: 0, productionPlan: 0, cannotBeMade: 0 },
  );

  const categorySections = [...byCategory.entries()].map(([category, categoryRows]) => {
    const categoryTotal = totals(categoryRows);
    const itemRows = [...categoryRows]
      .sort((a, b) => {
        if (b.productionPlan !== a.productionPlan) return b.productionPlan - a.productionPlan;
        return a.itemCode.localeCompare(b.itemCode);
      })
      .map((row) => {
        const week = weekLabel(row.releaseWeek);
        const weekBackground = WEEK_COLORS[week] ?? "#f3f3f3";
        const statusClass = row.cannotBeMade > 0 ? "cannot" : "";
        return `<tr>
          <td class="left">${escapeHtml(row.itemCode)}</td>
          <td class="left">${escapeHtml(row.colour)}</td>
          <td>${formatNumber(row.productionPlan)}</td>
          <td class="${statusClass}">${formatNumber(row.cannotBeMade)}</td>
          <td style="background:${WEEK_COLORS.W1}">${formatNumber(row.w1)}</td>
          <td style="background:${WEEK_COLORS.W2}">${formatNumber(row.w2)}</td>
          <td style="background:${WEEK_COLORS.W3}">${formatNumber(row.w3)}</td>
          <td style="background:${WEEK_COLORS.W4}">${formatNumber(row.w4)}</td>
          <td style="background:${weekBackground}">${week}</td>
          <td class="left">${escapeHtml(row.material ?? "")}</td>
        </tr>`;
      }).join("");

    return `<section class="category-section">
      <h2>${escapeHtml(category)}</h2>
      <table>
        <thead><tr>
          <th>Item Code</th><th>Colour</th><th>Production Plan</th><th>Cannot Be Made</th>
          <th>W1</th><th>W2</th><th>W3</th><th>W4</th><th>Assigned Week</th><th>Material</th>
        </tr></thead>
        <tbody>
          ${itemRows}
          <tr class="total-row">
            <td class="left">TOTAL</td><td></td>
            <td>${formatNumber(categoryTotal.productionPlan)}</td>
            <td>${formatNumber(categoryTotal.cannotBeMade)}</td>
            <td>${formatNumber(categoryTotal.w1)}</td>
            <td>${formatNumber(categoryTotal.w2)}</td>
            <td>${formatNumber(categoryTotal.w3)}</td>
            <td>${formatNumber(categoryTotal.w4)}</td>
            <td></td><td></td>
          </tr>
        </tbody>
      </table>
    </section>`;
  }).join("");

  return `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 landscape; margin: 10mm 8mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #222; font-size: 9px; }
          h1 { font-size: 18px; margin: 0 0 5px; }
          h2 { font-size: 14px; color: #17365d; margin: 0 0 8px; }
          p { margin: 3px 0; color: #666; }
          table { border-collapse: collapse; width: 100%; margin-top: 10px; }
          th, td { border: 1px solid #cfcfcf; padding: 4px 5px; text-align: right; vertical-align: middle; }
          th { background: #434343; color: white; font-weight: bold; text-align: center; }
          .left { text-align: left; }
          .pass { color: #176b37; font-weight: bold; }
          .fail, .cannot { color: #9c0006; font-weight: bold; background: #f4cccc; }
          .total-row { background: #434343; color: white; font-weight: bold; }
          .total-row td { border-color: #434343; }
          .category-section { page-break-before: always; }
          .legend { display: flex; gap: 18px; margin-top: 12px; }
          .legend span { padding: 4px 8px; border: 1px solid #ccc; }
          .w1 { background: #fce5cd; }
          .w2 { background: #fff2cc; }
          .w3 { background: #d9ead3; }
          .w4 { background: #cfe2f3; }
          .unscheduled { background: #f3f3f3; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(segment)} Weekly Release Plan — ${escapeHtml(month)}</h1>
        <p>Source: ${escapeHtml(sourceDescription)}</p>
        <p>Invariant: Σ W1..W4 = Production Plan total</p>
        <table>
          <thead><tr>
            <th class="left">Category</th><th>W1</th><th>W2</th><th>W3</th><th>W4</th>
            <th>Production Plan</th><th>Cannot Be Made</th><th>Weekly Check</th>
          </tr></thead>
          <tbody>
            ${summaryRows}
            <tr class="total-row">
              <td class="left">GRAND TOTAL</td><td>${formatNumber(grand.w1)}</td>
              <td>${formatNumber(grand.w2)}</td><td>${formatNumber(grand.w3)}</td>
              <td>${formatNumber(grand.w4)}</td><td>${formatNumber(grand.productionPlan)}</td>
              <td>${formatNumber(grand.cannotBeMade)}</td><td>PASS</td>
            </tr>
          </tbody>
        </table>
        <div class="legend">
          <span class="w1">W1</span><span class="w2">W2</span>
          <span class="w3">W3</span><span class="w4">W4</span>
          <span class="unscheduled">Unscheduled / cannot be made</span>
        </div>
        ${categorySections}
      </body>
    </html>`;
}

export async function exportWeeklyReleasePdf(
  month: string,
  rows: FrozenPlanRow[],
  sourceDescription = "capacity-fitted finalized plan",
  segment = "PTMT",
): Promise<Buffer> {
  assertWeeklyProductionConservation(rows);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(buildWeeklyPdfHtml(month, rows, sourceDescription, segment), {
      waitUntil: "networkidle0",
      timeout: 120_000,
    });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      timeout: 120_000,
      margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}