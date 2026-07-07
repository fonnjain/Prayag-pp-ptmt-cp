import type { CalcPlanItem, PlanSummaryResult } from "./calc";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(month: string, items: CalcPlanItem[], summary: PlanSummaryResult): string {
  const byCategory = new Map<string, CalcPlanItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const summaryRows = summary.categories
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.category)}</td><td>${c.minTotal.toLocaleString()}</td><td>${c.maxTotal.toLocaleString()}</td></tr>`,
    )
    .join("");

  const categorySections = [...byCategory.entries()]
    .map(([category, categoryItems]) => {
      const rows = categoryItems
        .map((item) => {
          const planClass = item.maxProduction > 0 ? "red" : "green";
          const minClass = item.minProduction > 0 ? "red" : "green";
          const orderClass = item.order > 0 ? "blue" : "";
          return `<tr>
            <td>${escapeHtml(item.itemCode)}</td>
            <td>${escapeHtml(item.colour)}</td>
            <td>${item.avg3MoSale.toLocaleString()}</td>
            <td>${item.pendingOrder.toLocaleString()}</td>
            <td>${item.pendingOrderLastMonth.toLocaleString()}</td>
            <td>${item.bufferReq.toLocaleString()}</td>
            <td>${item.stock.toLocaleString()}</td>
            <td class="${minClass}">${item.minProduction.toLocaleString()}</td>
            <td class="${planClass}">${item.maxProduction.toLocaleString()}</td>
            <td class="${orderClass}">${item.order.toLocaleString()}</td>
          </tr>`;
        })
        .join("");
      return `<h2>${escapeHtml(category)}</h2>
        <table>
          <thead><tr>
            <th>Item Code</th><th>Colour</th><th>Avg 3-Mo Sale</th><th>Pending Order</th>
            <th>Pending Last Mo</th><th>Buffer Req</th><th>Stock</th><th>Min Production</th>
            <th>Production Plan</th><th>Order</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    })
    .join("");

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
      h1 { font-size: 18px; }
      h2 { font-size: 14px; margin-top: 24px; page-break-before: always; }
      table { border-collapse: collapse; width: 100%; margin-top: 8px; }
      th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: right; }
      th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
      .red { background-color: #f4cccc; }
      .green { background-color: #d9ead3; }
      .blue { background-color: #cfe2f3; }
    </style>
  </head>
  <body>
    <h1>PTMT Production Plan — ${escapeHtml(month)}</h1>
    <table>
      <thead><tr><th>Category</th><th>Min Production Required</th><th>Max Production Required</th></tr></thead>
      <tbody>${summaryRows}
        <tr><td><b>TOTAL</b></td><td><b>${summary.grandMinTotal.toLocaleString()}</b></td><td><b>${summary.grandMaxTotal.toLocaleString()}</b></td></tr>
      </tbody>
    </table>
    ${categorySections}
  </body>
  </html>`;
}

export async function exportPlanPdf(
  month: string,
  items: CalcPlanItem[],
  summary: PlanSummaryResult,
): Promise<Buffer> {
  const html = buildHtml(month, items, summary);
  const puppeteer = (await import("puppeteer")).default;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfUint8 = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}
