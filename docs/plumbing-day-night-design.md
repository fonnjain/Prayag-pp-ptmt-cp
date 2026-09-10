# Plumbing day/night capacity design

Status: deferred. Do not implement this split until the September BOM and roster
questions are resolved.

## Intended model

- Each machine has two explicit blocks per working day:
  - `DAY`: 10 hours
  - `NIGHT`: 10 hours
- The combined ceiling remains 20 machine-hours per day. No third block or
  partial shift is introduced.
- Allocation should fill `DAY` first.
- If a machine's remaining demand cannot fit in the day block, the cascade
  escalates to `NIGHT` starting in W1, while retaining the existing dedicated
  and flex-machine routing rules.
- The cascade must record the consumed block for each allocation so weekly
  machine load can show day hours, night hours, and the resulting shift status.
- Residual demand still carries across weeks and remains unfulfillable after W4
  under the existing rules.

## Important scheduling trap

Do not wait until the month runs out of weeks and add night hours only at the
point of overflow. That places the night shift in W4, leaves no recovery window,
and reverses the intended behavior. Night capacity must be escalated from W1;
later weeks can then return to day-only when the backlog fits in the day block.

## Scope and sequencing

The expected value is crew-cost and shift visibility, not additional pieces.
Moulding is already fully loaded in the current September replay, so the
meaningful benefit is concentrated in the PIPE pool. The BOM-weight and
unclassified-roster work comes first.
