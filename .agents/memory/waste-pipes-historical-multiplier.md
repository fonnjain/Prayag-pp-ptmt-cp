---
name: Waste Pipes historical multiplier
description: Historical daily-production workbook evidence for Waste Pipes buffer multipliers.
---

The linked PTMT daily-production workbooks expose `LAST 3 MONTH AVG SALE` and `BUFFER STOCK REQ FOR <month>`. Item-level ratios are internally consistent within each populated month, but not consistent across months: March, April, and July are approximately 1.5×; June is approximately 1.2×. May repeats April's average/buffer values and should not be treated as independent evidence. January and February have zeroed average/buffer fields.

**Why:** a single multiplier inferred from one month would misrepresent the workbook's observed policy; the June 1.2× exception is real and applies to both WASTE PIPE and COLLAPSIBLE WASTE PIPE rows.

**How to apply:** keep Waste Pipes' multiplier and capacity held until the business approves which month/policy governs. Never auto-assign 1.5× or 1.2× from the historical ratio alone.