---
name: Source segment validation
description: Workbook folders and filenames are not reliable segment evidence; validate the category vocabulary before assigning stock or pending data.
---

Segment assignment must be validated from the workbook's actual category values, not inferred from its directory or filename. A file presented as CP can contain only Plumbing material categories and must be quarantined until its true owner is confirmed.

**Why:** A CP-folder workbook contained 486,033 pieces whose categories were entirely CPVC, UPVC, SWR, and AGRI; accepting the folder label would have assigned Plumbing dummy stock to CP.

**How to apply:** Before importing a cross-segment stock or pending workbook, inspect representative category values and compare them with the target segment's allow-list. Keep the source unresolved when the vocabularies do not match.