# Plant Velocity — Plain-Language Data and Calculation Explanation

This document explains the **PTMT Plant Velocity** screen shown in the Production Monitoring application.

The screen is a comparison between:

1. **What the plant actually produced**, and
2. **What the finalized production plan expected the plant to produce**.

The screen is displayed in **pieces / numbers (pcs or NOS)**, not kilograms.

---

## 1. What the screen is showing

The screenshot is for:

- **Segment:** PTMT
- **Month:** August 2026
- **Data through:** 19 August 2026
- **Working days elapsed:** 16
- **Total working days in August:** 26

Sundays are excluded from working-day calculations. The application does not assume that every calendar day is a production day.

For example, from 1 August through 19 August 2026, three Sundays are excluded, leaving 16 elapsed working days.

---

## 2. Main data sources

### A. Actual production source

**Google Spreadsheet name:** `PTMT ANUJ`  
**Tab name:** `Production`

This is the source for actual daily production.

The application reads these fields from the `Production` tab:

| Field | Meaning |
|---|---|
| Date | The day on which production happened |
| Item Code | The product/item produced |
| Colour | The colour or variant, where applicable |
| Qty / Quantity | Number of pieces produced |
| Group | The production group, retained as source information |

Only rows that satisfy all of the following are used:

- The date can be understood by the system.
- The date belongs to the selected month.
- The item code is not blank.
- The quantity is greater than zero.

The application adds together all valid rows for the same day. Therefore, if the sheet contains several rows for one day, they are combined into one daily production total.

The latest date found in this source becomes the **data-through date** shown on the page.

### B. Production target source

For the current monitoring month, the target is **not read directly from a live spreadsheet every time the Velocity page opens**.

The target comes from the latest **finalized PTMT production plan run** stored by the application.

That finalized plan contains, per item:

- Item code
- Colour
- Category
- Maximum planned production, called **Max PP**
- Minimum planned production
- Weekly release allocation:
  - W1
  - W2
  - W3
  - W4

This design is intentional. Once a plan is finalized, monitoring uses the issued plan rather than silently changing the historical comparison when editable source data changes.

### C. Spreadsheet/reference sources used when creating a plan

The following named spreadsheets are reference sources used by the planning process where applicable:

| Spreadsheet name | General use |
|---|---|
| `Sale 26-27` | Sales history, including the average three-month sales reference used during planning |
| `Pending order` | Pending-order reference where a planning process explicitly uses the connected sheet |
| `PTMT ANUJ` | PTMT production source and, for some historical/master-data paths, PTMT source reference |
| `Order Sheet 26-27` | Order information/reference used by other planning and operations flows |
| `SALE SHEET 26-27` | Sales data used by plan-versus-actual and related reporting flows |
| `CODE WISE SALE 25-26` | Code-wise historical sales reference |
| `rate list` | Rate/reference information used by related planning or reporting flows |

For the **Plant Velocity calculations themselves**, the two most important inputs are:

1. Actual production from `PTMT ANUJ` → `Production`
2. Targets and weekly releases from the finalized PTMT plan run

Current planning rules keep stock and pending-order inputs isolated from live sheet reads and use the plant's uploaded planning files for those inputs. Therefore, those uploads can affect the finalized plan, but they are not directly re-read by the Velocity page for the KPI calculation.

### D. Historical and closed-month behaviour

For a closed month, the application uses the captured monitoring snapshot for that month. The snapshot preserves:

- The finalized plan used
- The production actuals used
- The plan-version history
- The weekly release information
- The source dates and capture time

This prevents a closed month's report from changing later because someone edited a current spreadsheet or created a newer plan.

---

## 3. How the target is prepared

The finalized plan contains item-level maximum and minimum production quantities.

The plant-level totals are calculated as:

```text
Plant Max PP = sum of Max PP for all planned items
Plant Min PP = sum of Min PP for all planned items
```

The application also groups the same item-level targets by category:

```text
Category Max PP = sum of Max PP for items in that category
```

Actual production is matched to the plan using:

1. Item code + colour, when available.
2. Normalized item code as a fallback.

If an actual-production item cannot be matched to a plan item, it is put into a review list and is excluded from planned category totals. This avoids incorrectly assigning production to the wrong category.

---

## 4. Working-day logic

The application calculates:

```text
Elapsed working days = number of non-Sundays from the 1st of the month through the latest data date

Remaining working days = total working days - elapsed working days
```

For an open month:

- The latest available production data date controls how many days have elapsed.
- Future dates are not counted as produced.

For a closed month:

- The full configured working calendar is used.
- The stored snapshot is used instead of changing live data.

---

## 5. KPI calculations on the top row

### 5.1 Actual / Day

This is the average production achieved per elapsed working day.

```text
Actual / Day = Produced to date ÷ Elapsed working days
```

Example:

```text
If 556,304 pieces were produced over 16 working days:
Actual / Day = 556,304 ÷ 16 = 34,769 pieces/day
```

This is an average. It does not mean the plant produced exactly that quantity every day.

### 5.2 Required / Day

This is the average daily production needed to complete the plant's Max PP within the month's working calendar.

```text
Required / Day = Plant Max PP ÷ Total working days
```

Example:

```text
If Plant Max PP is 658,840 pieces and there are 26 working days:
Required / Day = 658,840 ÷ 26 = 25,340 pieces/day
```

The value is rounded to two decimal places by the calculation engine and displayed as a whole number on the card.

### 5.3 Cumulative Attainment

This answers:

> Compared with the amount that should have been completed by now, how much has actually been completed?

```text
Cumulative Attainment %
  = Produced to date ÷ Required cumulative production to date × 100
```

The required cumulative production is normally:

```text
Required cumulative = Required / Day × elapsed working days
```

When a plan revision became effective during the month, the calculation uses the applicable plan version for each date. In other words, it does not blindly apply today's target to every earlier day.

Interpretation:

- `100%` means exactly on the expected pace.
- Above `100%` means ahead of the expected pace.
- Below `100%` means behind the expected pace.

This is a **pace measure**, not final monthly completion. A plant can show more than 100% cumulative attainment and still have work remaining for the month.

### 5.4 Projected End

This estimates where the plant would finish if the current average daily production continued for the rest of the month.

```text
Projected month-end production
  = Actual / Day × Total working days

Projected End %
  = Projected month-end production ÷ Plant Max PP × 100
```

Interpretation:

- `100%` means the current pace would finish at Max PP.
- `137.2%` means the current pace would finish at approximately 137.2% of Max PP.
- A result below `100%` means the current pace would not reach Max PP without improvement.

This is a projection, not a guarantee.

### 5.5 Linearity

Linearity measures how evenly production is spread across the elapsed working days.

The calculation is deliberately capped per day:

```text
Capped daily production = minimum(actual production for the day, Required / Day)

Linearity
  = sum of capped daily production ÷ Required cumulative production to date
```

Why cap each day?

If the plant produces twice the required quantity on one day and produces nothing on another day, the plant should not receive a perfect smoothness score merely because the total quantity is large. The cap prevents one very high day from hiding several zero or low-production days.

Interpretation:

- `1.00` means production has followed the expected daily pattern very closely.
- A lower number means production is more uneven or back-loaded.
- The UI specifically highlights values below `0.60` as back-loaded.

---

## 6. Weekly cards: W1, W2, W3 and W4

The month is divided into four calendar windows:

| Week | Calendar range |
|---|---|
| W1 | Day 1–7 |
| W2 | Day 8–14 |
| W3 | Day 15–21 |
| W4 | Day 22 through the last day of the month |

For August 2026:

- W1 = 1–7 August
- W2 = 8–14 August
- W3 = 15–21 August
- W4 = 22–31 August

### Released

`Released` is the amount the finalized plan allocated to that week.

```text
Weekly Released
  = sum of the weekly release quantity for all planned items
```

It is a plan quantity, not actual production.

### Actual

`Actual` is the production quantity from `PTMT ANUJ` → `Production` whose dates fall inside that calendar week.

```text
Weekly Actual
  = sum of valid production rows dated inside the week
```

For the current week, only data available up to the latest source date is included. A future week therefore normally shows zero actual until production data exists.

### Attainment

The weekly card displays:

```text
Weekly Attainment %
  = Weekly Actual ÷ Weekly Released × 100
```

The colour meaning is:

- Green: at least 95%
- Amber: at least 85% but below 95%
- Red: below 85%

### Gap

The displayed gap is the remaining quantity against the effective weekly requirement:

```text
Gap = maximum(Effective weekly target - Weekly Actual, 0)
```

If a previous week finished below its target, that shortfall can become **carry-in** for a later week. The effective target is:

```text
Effective weekly target = current weekly target + carry-in
```

The card's Attainment percentage is based on the direct weekly target; the gap also considers carry-in.

---

## 7. Burn-up chart

The chart combines four views:

### Daily Output bars

Each light-blue bar is the actual number of pieces produced on that working day.

### Actual Cumulative line

The blue line is the running total:

```text
Cumulative actual on a date
  = sum of all actual production from the first day through that date
```

### Released (Weekly Step) line

The purple stepped line shows cumulative weekly plan release:

```text
After W1 = W1 release
After W2 = W1 release + W2 release
After W3 = W1 release + W2 release + W3 release
After W4 = total release for the month
```

It is drawn as steps because the plan is released in weekly blocks, not as a new target for every individual day.

### Required / Day reference line

The horizontal reference line is the `Required / Day` KPI. It helps compare each day's actual output with the average daily quantity needed.

If no weekly targets are available, the chart uses a required-cumulative line instead of the weekly release step line.

---

## 8. Day-by-day table

The table shows only elapsed working days and contains:

| Column | Calculation |
|---|---|
| Day | Working-day number, such as D1, D2, D16 |
| Date | Production date |
| Week | W1, W2, W3 or W4 based on calendar date |
| Actual | Valid production quantity for that date |
| Required | Daily target for that date |
| Cum Actual | Running total of actual production |
| Cum vs Released | Cum Actual minus the applicable cumulative released target |

The final column is positive when cumulative actual production is above the released target and negative when it is below.

---

## 9. Cache and refresh behaviour

The production source is cached by month for performance.

- The cache is normally valid for up to 15 minutes for the actual-production ingestion.
- The full monitoring result is shared between the bundle and weekly-summary endpoints and is cached for up to 5 minutes.
- A sync or relevant configuration change invalidates the monitoring cache.

Therefore, a newly edited spreadsheet may not appear immediately if the cache has not expired or been invalidated.

---

## 10. Important limitations and safeguards

1. **The screen is piece-based.** It does not convert PTMT output to kilograms for these KPIs.
2. **Only positive quantities are counted.** Blank, invalid, zero and negative quantity rows are not added to production.
3. **Only the selected month is counted.** Rows from another month are ignored for that month's screen.
4. **Unmatched production items are not silently assigned.** They are flagged for review and excluded from planned category totals.
5. **A finalized plan is used for monitoring.** Draft or non-finalized plans should not drive the monitoring comparison.
6. **Plan revisions are date-aware.** A revised plan applies from its effective date rather than rewriting all earlier dates.
7. **Closed months are frozen.** Historical results use the captured snapshot and are not recalculated from today's editable data.
8. **The projection assumes the current average continues.** It does not automatically account for future breakdowns, holidays, overtime, product mix changes or capacity changes.

---

## 11. Simple one-line summary

> The Plant Velocity page takes actual piece production from **PTMT ANUJ → Production**, compares it with the **finalized PTMT production plan and its weekly releases**, excludes Sundays and future dates, and calculates pace, attainment, projection and smoothness using the formulas described above.
