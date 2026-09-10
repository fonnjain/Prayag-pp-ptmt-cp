---
name: Plumbing machine scheduler adapter
description: External Plumbing scheduling requires the shared Sunday-aware calendar, per-kind results, and explicit handling of upstream route/BOM gaps.
---

The machine scheduler accepts `segment: "PLUMBING"`, `month: YYYY-MM`, `kind: "pipe"|"fitting"`, four positive `week_days`, and demand rows with `item_code`, `material`, and `qty_pcs`. Results echo `kind` and `week_days`; unfinished rows expose `remaining_pcs`, `remaining_kg`, `remaining_hours`, and `capable_machines`. Upstream machine IDs may include formatting/capacity suffixes, so compare normalized aliases to local lockout IDs.

**Why:** The upstream rejects a whole batch when any item has no capable route or no BOM weight, instead of returning that item as unfinished. Its `downtime_hours_lost`/`downtime_machine_days` fields can be zero even when capacity minus scheduled minus idle is positive; that remainder must stay explicitly unallocated rather than being relabeled as downtime.

**How to apply:** Build `week_days` through `working-days.ts` using observed worked Sundays, validate distinct materials against CPVC/UPVC/SWR/AGRI before calls, schedule pipe before fitting with identical request context, persist each raw result by kind, and merge only for display. Surface route gaps, solvent exclusions, capable-machine saturation/lockout, downtime fields, and the independent unallocated-hours reconciliation.

The published `prayag-plant.com/data-api/v1` exposes health, periods, plants, records, summary, and schedule only; it does not expose the machine app's internal `mp_routing` table. A scheduler rejection of `no BOM weight` is evidence about the public master/BOM, not proof that `mp_routing` lacks the family.

**Why:** Family-level probes for CH*, UH*, and CM* can fail before route lookup, so treating those responses as a routing-table absence would overstate what the API proves.

**How to apply:** Ask the machine-app owner to inspect `mp_routing` directly (or add a read-only routing metadata endpoint) before classifying these families as unrouted. Until then, group the observable issue as a shared BOM/master-data gap.

The current scheduler response retains submitted lines in `coverage.items`, reports non-allocatable lines in `data_limited`, and exposes `demand_reconciliation`; these fields are contract evidence even when `blocks` is empty. A structured all-data-limited HTTP 422 may omit top-level `kind`, `week_days`, and `params_used`; normalize those echoes from the request before parsing. The September 2026 basis is `[6,6,6,8]` (26 days).

**Why:** A data-limited line is not the same as a zero-quantity line or an unfinished capacity allocation. Consumers that inspect only blocks can lose the distinction and overstate what was scheduled.

**How to apply:** Keep coverage/data-limited handling explicit before any real fit. The current machine facts are that MC8 has one AGRI route while MC7 has configured hours but zero routing rows; the public schedule call itself is non-persistent.

Corrective schedules use a shortened positive calendar after closed weeks. The scheduler's local W1 maps back to the original calendar week by the closed-week offset; persist and consume that offset everywhere, including invariants, exports, and UI. Persisted legacy corrective runs may lack the newer category/feasibility fields, so detail responses and renderers must hydrate safe defaults.

**Why:** Raw scheduler week labels otherwise release work into already-closed weeks, and older rows can crash the corrective detail page when newer fields are assumed to exist.

**How to apply:** Normalize scheduler blocks before storing weekly allocations; expose the normalized week metadata with the run; treat missing legacy categories as an empty list and missing fitted/cannot fields as zero.

Corrective allocation must subtract `data_limited` demand before deriving scheduled pieces; data-limited lines have no production blocks and must not be treated as scheduled or unfinished. Use the shared normalized production-code key for block accumulation and demand lookup.

**Why:** The upstream can return a valid response with coverage/data-limited rows but no blocks for those items; allocating from gross demand then creates phantom scheduled pieces and a misleading no-block failure.

**How to apply:** Reconcile each demand row as `demand − unfinished − data-limited` before weekly allocation, and normalize punctuation variants consistently on both sides of every join.

The machine app source audit provides a stronger source-level result: its pipe `Details` sheet has no CH/UH/CM routing rows, and fitting `Report-12` has no target rows (only unrelated `CM21S`). The BOM `NEW` parser column contains CH/CM targets with `0.000` weights, which are skipped, while UH targets are absent from that parsed column. Every UH occurrence elsewhere in `NEW` is an unweighted auxiliary code/reference cell (F/G), paired with a PS code and its weight in A/B and J/K; it is not a hidden UH weight.

**Why:** `seed_pipe_routing` and `seed_fitting_routing` clean their respective routing pools before upserting parsed rows, so a clean seed from these sources cannot create routing entries for the 20 target codes. The gap is family-level in the current source inputs, not 20 scattered scheduler anomalies.

**How to apply:** Treat CH/UH/CM as a shared source/master-data gap and ask whether those families belong in the source routing and BOM sheets. Do not expand the BOM parser to consume the auxiliary F/G cells: they contain aliases/references, not weights.