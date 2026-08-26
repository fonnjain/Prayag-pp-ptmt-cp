---
name: CP Stage 0 source gate
description: CP dummy-stock baseline and workbook parsing rules that must be settled before CP planning implementation.
---

# CP Stage 0 source gate

Stage 0 remains blocked until the current `Production Plan CP JUL' 2026` workbook with its 12 category tabs is supplied. Do not use a positional rule such as “after `AVG RATE`” or “row N onward”: six tabs repeat `AVG RATE`, so those rules overlap and double- or triple-count. Instead, locate the header row that explicitly names `ITEM CODE`, resolve the `PENDING ORDER LAST MONTH` field from that structure, and collect item-detail rows until the next non-item marker. `CP ACC` and `CP TOP ITEM` are item-level tabs, but must still be bounded by their item-code structure.

**Why:** Summing both blocks produced the unverified 92,301 figure and inflated the roster count. A structural detail-block parse of the archived workbook's 2026-08-21 report reproduces 53,035; it is a comparison anchor only, not the live figure.

**How to apply:** Always report per-tab totals and the grand total before adopting CP dummy stock. For every tab, assert that the selected detail sum does not exceed the corresponding summary-block total; fail the parse if it does. Treat `SPL` as a subtotal/residual label unless the current source proves it is a real item.

## Archived comparison anchor

Workbook report as-of date: **2026-08-21**. The attached archive snapshot was captured on 2026-08-26. The item-detail-only `PENDING ORDER LAST MONTH` breakdown is:

| Tab | Detail total |
|---|---:|
| `CP ACC` | 6,058 |
| `CP TOP ITEM` | 20,215 |
| `5000` | 1,197 |
| `GOVT.` | 410 |
| `CP FOCUS 1` | 11,039 |
| `CP FOCUS 2` | 718 |
| `CP FOCUS 3` | 730 |
| `CP FOCUS 4` | 46 |
| `CP FOCUS 5` | 29 |
| `CP ACCESSORIES` | 860 |
| `CP W, B,EX,PRJ & ALLIED` | 7,742 |
| `CP SHOWER AND HEALTH FACUET` | 3,991 |
| **Grand total** | **53,035** |

This archived 53,035 anchor must be compared with the same structural parse of the current workbook when it arrives. The difference can then be assessed as genuine month-on-month movement versus another parsing artefact.