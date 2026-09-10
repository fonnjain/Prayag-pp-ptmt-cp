---
name: Plumbing achievability export
description: Source and conservation rules for the Plumbing achievable/unfeasible workbook worksheets.
---

The Plumbing achievable and unfeasible worksheets are a read-only presentation of a frozen Temporary Plan plus an in-memory machine cascade. They must not create, finalize, publish, or mutate a plan run. Achievable and unfeasible quantities are calculated independently, then conserved per item, category, and total against temporary demand. Unfeasible reasons stay distinct: CAPACITY, NO ROUTE, NO BOM WEIGHT, and DATA LIMITED. The unfeasible worksheet begins with the explicit no-carry-over sentence for the month.

**Why:** The worksheet is intended to explain monthly executable capacity without turning an exploratory comparison into an issued production plan or hiding data-quality causes inside capacity.

**How to apply:** Keep PTMT export changes separate until its read-only export brief confirms whether existing persisted production/cannot-be-made fields already provide the needed presentation.