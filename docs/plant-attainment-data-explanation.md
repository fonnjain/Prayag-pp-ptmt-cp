# PTMT Plant Attainment — Plain-English Data and Calculation Guide

This guide explains the **Plan vs Actual Attainment** screen shown in the
attached screenshot.

The screenshot is the **PTMT** segment, **August 2026**, on the **Overview**
tab. The chart title is **Category Produced vs Max PP**.

The short version is:

> The coloured part of each bar is what the plant has produced so far for that
> category. The light-grey part is what is still left against that category's
> maximum production plan.

The chart is measured in **pieces / numbers (pcs or NOS)**, not kilograms.

---

## 1. What the screen is doing

When the page opens, the browser requests the PTMT plant bundle for the
selected month:

```text
PTMT + August 2026
        ↓
Plant monitoring calculation
        ↓
Category Produced vs Max PP chart
```

The application combines:

1. **Actual production rows** from the production spreadsheet.
2. **The issued PTMT production plan** stored by the application.
3. The selected month calendar and working-day rules.
4. Item-code matching so production is assigned to the correct category.

The browser does not calculate the production totals from the screenshot. The
server calculates them and sends category totals to the browser.

---

## 2. The exact chart in the screenshot

The chart has one horizontal bar per PTMT category, for example:

- Faucets & Jets
- Accessories
- Cistern & Seat
- Cocks Standard
- Cocks Premium
- Ball Cock
- Cabinet

Each bar is stacked into two parts:

| Chart part | Meaning |
|---|---|
| Coloured bar | Pieces produced so far and successfully matched to a planned item in that category |
| Light-grey bar | Positive remaining quantity against the category's Max PP |

The grey part is calculated as:

```text
Remaining = maximum(Category Max PP − Category Produced, 0)
```

Therefore:

```text
Coloured part + Grey part = Category Max PP
```

unless production is already greater than the target. If production is above
the target, the grey part becomes zero and the coloured part may extend beyond
the original target.

The chart's shortened labels are only a display choice. For example,
`Cocks Standard` is still represented by its full category name in the data.

---

## 3. Actual production source

### Google Spreadsheet: `PTMT ANUJ`

### Tab: `Production`

This is the direct source for the **Produced** quantity.

The application reads the production rows and uses these fields:

| Field | Plain-English meaning |
|---|---|
| Date | The date on which the production happened |
| Item Code | Which product was produced |
| Colour | The colour or variant, where applicable |
| Qty / Quantity | How many pieces were produced |
| Group | Kept as source information; it is not used to calculate the chart total |

The actual-production reader:

1. Reads the `Production` tab.
2. Understands common date formats, including spreadsheet date values.
3. Keeps only rows belonging to the selected month, such as August 2026.
4. Ignores rows with a blank item code.
5. Ignores rows whose quantity is zero or negative.
6. Converts the item code and colour to a consistent comparison format.
7. Adds all valid rows together.

If the same item was produced on several days, or appears on several rows on
one day, all those quantities are added.

### Example

If `Cocks Standard` has these valid production rows:

```text
1 August  — 20,000 pcs
4 August  — 35,000 pcs
12 August — 40,000 pcs
```

then:

```text
Cocks Standard Produced = 20,000 + 35,000 + 40,000
                         = 95,000 pcs
```

The latest valid production date found for the selected month is used as the
data-through date. This is why the page shows elapsed working days rather than
assuming the whole month has already happened.

### Important limitation

The chart does **not** use the old `Stock Qty` columns in the `PTMT ANUJ`
spreadsheet. Those columns are treated as a stale opening-balance reference.
They are not used as current stock for this monitoring calculation.

---

## 4. Where Max PP comes from

### Direct chart source

The chart uses the latest **issued PTMT plan version** stored in the
application database.

That issued plan contains, for each planned item:

- Item Code
- Colour
- Category
- Max PP
- Min PP
- W1, W2, W3 and W4 release quantities

The monitoring page normally does **not** rebuild this plan from spreadsheets
every time the chart opens. This is intentional: after a plan is issued, the
monitoring comparison should remain tied to that issued plan instead of
silently changing whenever an input file is edited.

For a closed month, the application uses the frozen monitoring snapshot for
that month. This preserves the plan and actual production that were used at
the time the month was closed.

### Category Max PP

The item-level plan is grouped by category:

```text
Category Max PP
  = sum of Max PP for every planned item in that category
```

The plant-wide total follows the same rule:

```text
Plant Max PP
  = sum of Max PP for every planned item
```

`Min PP` is also retained and shown in the detail table, but it is not the
target used by the **Category Produced vs Max PP** bar.

---

## 5. Spreadsheet and upload sources used to create the PTMT plan

These inputs can affect the issued Max PP plan. They are **upstream plan
inputs**, not all direct inputs to the chart when the page is opened.

| Source name | What it contributes |
|---|---|
| `Sale 26-27` | Sales history used to calculate the average three-month sale reference |
| `DATA.xlsx` — pending orders upload | Current pending order quantity for PTMT rows |
| `FG Stock` — current stock upload | Current stock quantity used by the planning run |
| `Last-Month Pending` — upload | Pending quantity carried from the previous month |
| PTMT item master/catalogue | The list of PTMT item codes, colours and categories |
| PTMT buffer-category settings | The buffer multiplier used for each category; these settings are stored in the application |
| PTMT weekly release-band settings | How the total plan is distributed into W1–W4; these settings are stored in the application |

The current PTMT planning rule is applied item by item.

### Step 1: Average three-month sale

```text
Average 3-month sale
  = total sale quantity for the relevant three-month history ÷ 3
```

The sales-history reader uses the named spreadsheet `Sale 26-27`. It finds the
appropriate month/history tab and sums the item quantities by item code and
colour where applicable.

### Step 2: Buffer requirement

```text
Buffer requirement
  = Average 3-month sale × category buffer multiplier
```

The multiplier is category-specific and comes from the application's PTMT
buffer settings. A user override, when present, takes priority over the
stored default.

### Step 3: Maximum production plan

```text
Max PP
  = maximum(
      Buffer requirement
      − Current stock
      + Last-month pending
      + Current pending,
      0
    )
```

The `maximum(..., 0)` rule prevents an item from receiving a negative
production plan.

### Step 4: Category total

```text
Category Max PP
  = sum of the positive item-level Max PP values in that category
```

### What is not included in Max PP

The live order-book quantity is a separate operational number. It is not
added into the Max PP formula.

---

## 6. How production is assigned to a category

The application must decide which planned item owns each production row.

It tries the following matching order:

### First choice: item code + colour

This is used when the plan distinguishes multiple colours or variants for the
same item code.

```text
Production item code + production colour
  matches
Plan item code + plan colour
```

### Fallback: normalized item code

If the exact code-and-colour match does not work, the application compares a
normalized item code. Normalization removes formatting differences such as:

```text
A-465  →  A465
A 465  →  A465
A.465  →  A465
```

This allows a production sheet code such as `A465` to match a plan code such as
`A-465`.

### Unmatched production

If a production row cannot be matched to any planned item:

- It is not silently assigned to a category.
- It is excluded from the category's Produced total.
- It is listed for review as an unmatched item.
- A caveat is added to the monitoring result.

This protects the chart from putting production into the wrong category.

---

## 7. The working-day logic in the screenshot

The screenshot shows:

```text
16 / 26 days elapsed
```

The application treats Sundays as non-working days.

```text
Total working days
  = all days in the month except Sundays

Elapsed working days
  = all non-Sunday days from the 1st of the month
    through the latest available production date
```

For an open month, the latest valid production date from
`PTMT ANUJ` → `Production` controls the elapsed count.

For a closed month, the configured calendar and frozen snapshot are used.

The working-day count is used for pace and RAG calculations. It does not
change the raw number of pieces read from the production sheet.

---

## 8. Why the bar colour can differ from simple monthly completion

The coloured bar itself is the actual produced quantity. Its colour is a
traffic-light indicator based on **cumulative pace**, not simply on:

```text
Produced ÷ Max PP
```

For each category:

```text
Required cumulative quantity
  = sum of the category's expected daily target
    for all elapsed working days
```

The expected daily target is based on the active plan version for each date.
This matters if the plan was revised during the month.

Then:

```text
Cumulative attainment %
  = Category Produced ÷ Required cumulative quantity × 100
```

The RAG bands used by this page are:

| Band | Rule |
|---|---|
| Green | Cumulative attainment is at least 95% |
| Amber | Cumulative attainment is at least 85% but below 95% |
| Red | Cumulative attainment is below 85% |

So an orange category is not necessarily below its final monthly Max PP. It
means the category is behind the amount that the plan expected by the current
point in the month.

---

## 9. The other numbers shown below the chart

The chart is only the visual summary. The category detail table uses the same
underlying values.

### Produced

```text
Produced
  = sum of matched valid production rows for the category
```

### Max PP

```text
Max PP
  = sum of item-level maximum production plans in the category
```

### Gap

```text
Gap
  = Category Max PP − Category Produced
```

Unlike the grey chart segment, the table can show a negative gap if production
has exceeded the plan.

### Monthly attainment percentage

At item level, the table uses:

```text
Monthly attainment %
  = Item Produced ÷ Item Max PP × 100
```

### Projected end percentage

The page also calculates a pace projection:

```text
Actual pieces per day
  = Produced to date ÷ elapsed working days

Projected month-end pieces
  = Actual pieces per day × total working days

Projected end %
  = Projected month-end pieces ÷ Max PP × 100
```

This is a projection, not a guarantee.

---

## 10. Sources that are not direct inputs to this chart

The following named sources are used by other planning, order, sales, or
reporting flows, but they are not read directly to create the coloured and
grey bars on this specific Overview chart:

| Source name | Relationship to this chart |
|---|---|
| `Order Sheet 26-27` | Used for order-book and related reporting views; not added to Produced or Max PP here |
| `SALE SHEET 26-27` | Used by Plan-versus-Actual reporting/export flows; not the actual-production source for this chart |
| `CODE WISE SALE 25-26` | Historical/reference sales source for related flows; not directly used for the chart bars |
| `rate list` | Reference data for related planning/reporting; not directly used for the chart bars |
| `Pending order` | A named connected source used by some older/reference paths; current PTMT plan inputs use the uploaded `DATA.xlsx` pending-order rows |

The most important distinction is:

```text
Actual shown on chart
  = PTMT ANUJ → Production

Target shown on chart
  = issued PTMT plan stored by the application

Plan may have been created using
  = Sale 26-27 + DATA.xlsx + FG Stock + Last-Month Pending
    + item catalogue + application planning settings
```

---

## 11. Refresh and historical behaviour

The application keeps short-lived caches so the monitoring page does not
re-read every source for every browser request.

- The plant monitoring bundle is cached for about **5 minutes**.
- Current-month production ingestion is cached for about **15 minutes**.
- Older months normally use the stored ingestion result.
- A sync or source/configuration change invalidates the relevant cache.

This means a newly entered production row may not appear instantly. After the
cache is refreshed, the page recalculates the category totals.

Closed months are intentionally immutable. Their frozen snapshot protects the
historical result from later edits to the current spreadsheet or from a newer
plan being issued.

---

## 12. One complete example

Suppose the issued plan contains these `Cocks Standard` item targets:

```text
Item A Max PP = 100,000
Item B Max PP = 150,000
Item C Max PP = 50,000
```

Then:

```text
Cocks Standard Max PP = 100,000 + 150,000 + 50,000
                      = 300,000 pcs
```

Suppose matched production from `PTMT ANUJ` → `Production` is:

```text
Item A produced = 40,000
Item B produced = 90,000
Item C produced = 20,000
```

Then:

```text
Cocks Standard Produced = 40,000 + 90,000 + 20,000
                        = 150,000 pcs

Remaining = maximum(300,000 − 150,000, 0)
          = 150,000 pcs
```

The chart would show:

- Coloured bar: **150,000**
- Grey bar: **150,000**
- Total bar length: **300,000**

The bar colour would then be decided separately by comparing the 150,000
produced pieces with the cumulative amount the plan expected by the current
working day.

---

## 13. Final answer in one sentence

For the screenshot, the application reads actual pieces from
**`PTMT ANUJ` → `Production`**, compares them with the category totals from the
issued PTMT plan, matches production by item code and colour, calculates
`Remaining = max(Max PP − Produced, 0)`, and colours each category according to
whether its cumulative production pace is green, amber, or red.