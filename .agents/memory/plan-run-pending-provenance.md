---
name: Plan-run pending provenance
description: The durable audit rule for pending-order inputs attached to frozen plan runs.
---

Every newly created plan run must atomically preserve the exact pending sources it consumed for both current and last-month pending. Keep the source role and segment explicit, retain raw filtered rows plus parsed code/colour/quantity totals, and persist source identity, source upload time, capture time, and diagnostics. Do not reinterpret invoice quantity as open balance or reconstruct missing historical inputs. Older runs without these records must remain readable but be labeled as having no captured pending snapshot.

**Why:** Uploads can be replaced or cleaned up after a plan is issued, so an upload ID alone is not an immutable audit record; pending can also legitimately be zero when the source layout has no supported balance field.

**How to apply:** When adding or changing plan-run creation or corrective audit responses, preserve the source snapshot transactionally and expose its provenance/status to detail consumers while leaving frozen per-item inputs authoritative.