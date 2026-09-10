---
name: Manual-plan comparison grain
description: The durable scope and key-grain rule for comparing Prayag’s September manual plan with frozen app runs.
---

Prayag’s category tabs are item-code rows without colour, while frozen PTMT plan runs retain code-plus-colour rows. A valid comparison must aggregate frozen rows by item code for item-level arithmetic, preserve the manual category, and report category assignment separately.

**Why:** Joining a frozen run to its inputs by code and colour can duplicate repeated keys; comparing raw rows directly can mistake colour expansion for an app-only roster difference.

**How to apply:** Pair frozen results and inputs by ordinal row identity, aggregate app values by item code for the manual-plan comparison, keep duplicate manual code/category rows visible, and publish an itemized exception file alongside summary counts.