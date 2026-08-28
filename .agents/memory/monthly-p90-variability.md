---
name: Monthly p90 variability
description: How to interpret monthly p90 CV alongside endpoint and recovery drift for PTMT capacity.
---

Monthly p90 CV is the population standard deviation divided by the mean of positive-production monthly p90s, expressed as a percentage. Months without positive observations are excluded from the CV and remain visible through the separate zero-production signal.

**Why:** Recovery drift can be large both for a smooth directional trend and for a noisy series that happens to end above its minimum. CV makes that distinction visible instead of presenting the adaptive full/recent window choice as certainty.

**How to apply:** Treat CV above 25% as high variability: keep the selected window as an operational suggestion if needed, but flag that neither window is reliable alone and require review/override. Use lower CV with endpoint/recovery drift as stronger evidence of a directional change, not as proof of causation.