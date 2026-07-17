---
name: Plumbing golden values
description: July 2026 verified Production Required (PCS) per category; column letter varies per master tab; SWR Solvent is 9th category.
---

## Rule
The Plumbing self-check asserts 9 exact integer golden values against the live plan.
Every category must be non-zero — none are informational/optional.

## Verified July 2026 values
| Category      | Production Required (PCS) |
|---------------|--------------------------|
| CPVC Pipe     | 130,451                  |
| CPVC Fitting  | 763,253                  |
| UPVC Pipe     |  51,899                  |
| UPVC Fitting  | 633,038                  |
| SWR Pipe      |  64,515                  |
| SWR Fitting   | 236,315                  |
| SWR Solvent   |   1,255                  |
| AGRI Pipe     |   9,688                  |
| AGRI Fitting  |  14,814                  |
| **TOTAL**     | **1,905,228**            |

Source: Daily Production PLUMBING master Excel, per-material tabs.

## Why column letter differs per tab
The "PRODUCTION REQUIRED FOR Jul26 (PCS)" column sits at a different position per tab:
- CPVC tab → col O
- UPVC tab → col Q
- SWR  tab → col S
- AGRI tab → col S

Do not assume a fixed column; detect by the header label.

## SWR Solvent is the 9th category
SWR Solvent (solvent cement) is a manufactured product separate from SWR Pipe/Fitting.
In the FG Stock file its Category column contains "SOLVENT" or "SWR CEMENT".
`inferPlumbingCategory` detects SOLVENT/SWR+CEMENT BEFORE the generic SWR check to prevent misclassification.
Seeded in `buffer_categories` and `weekly_release_bands` via migration 007.

**Why:**
Previous session incorrectly noted "SWR and AGRI may show 0, which is correct" — that was based on reading the wrong column in the master Excel. All 9 categories have real plan quantities.
