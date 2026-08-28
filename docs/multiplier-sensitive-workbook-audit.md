# Multiplier-sensitive PTMT workbook audit

Audit date: 2026-08-27

The nine codes below were checked before treating catalogue classification as
evidence:

`123-FH`, `124-FH`, `130-RN`, `1322-HN`, `1375-SP`, `146-HB`, `147-HQ`,
`147-RQ`, and `148-HB`.

## Evidence found

The two copies of the July PTMT production plan contain the same code-level
rows. In the plan sheets, the reviewed multipliers are:

| Code | July standard / accessory multiplier | July premium multiplier | July movement / pending evidence |
| --- | ---: | ---: | --- |
| 123-FH | 1.5 | 1.2 | Standard WHITE: 429 average, 736 pending, 709 stock; IVORY pending 24. Premium: 429 average, 736 pending, 709 stock, 24 pending. |
| 124-FH | 1.5 | 1.2 | Standard WHITE: 368 average, 736 pending, 666 stock; IVORY pending 334. Premium: 368 average, 736 pending, 666 stock, 334 pending. |
| 130-RN | 1.5 | 1.2 | Standard IVORY: 33 average, 64 pending, 34 stock; WHITE pending 100. Premium: 33 average, 64 pending, 34 stock, 100 pending. |
| 1322-HN | 1.5 | 1.2 | Standard WHITE: 40 average, 0 pending, 0 stock; IVORY pending 53. Premium: 40 average, 0 pending, 0 stock, 80 pending. |
| 1375-SP | 1.5 | 1.2 | Standard WHITE: 10 average, 18 pending, 0 stock; IVORY pending 5. Premium: 10 average, 18 pending, 0 stock, 5 pending. |
| 146-HB | 1.5 | 1.2 | Standard/accessory and premium rows are present; movement and pending are zero in the plan rows. |
| 147-HQ | 1.5 | 1.2 | Standard WHITE and premium rows are present; pending is 4 in both rows. |
| 147-RQ | 1.5 | 1.2 | Standard WHITE pending 39 and IVORY pending 56; premium pending 95. |
| 148-HB | 1.5 | 1.2 | Standard/accessory and premium rows are present; pending is 5 in the reported rows. |

The July workbook also contains these codes in its production, sale, and
order tabs. For example, the production tab records July production for
`123-FH`, `124-FH`, `130-RN`, and `1375-SP`, while the order tab records
`124-FH` and `1375-SP` demand extending into August.

## Negative / non-authoritative evidence

- `PTMT_June2026_Corrected_Logic_1781522579415.xlsx` produced no exact
  base-code rows for the nine-code set. It is not used as positive
  classification evidence.
- `revised_production_plan_2026-08_(1)_1787032433831.xlsx` produced no exact
  base-code rows for the nine-code set. It is not used as positive
  classification evidence.
- `3._PTMT_PLAN_&_ACTUAL_-_JULY-26_1787132858633.xlsx` contains the July
  evidence plus historical/derived report tabs. Its derived tabs are not
  allowed to override the plan-sheet multipliers.

## Classification consequence

The July plan is sufficient evidence for the reviewed category/multiplier
rows. A product that remains absent or unresolved in the planning roster must
remain `unclassified` with `bufferReq = null`; confirmed pending demand can
still drive its demand-only production plan. No multiplier was inferred from
product-name similarity or from a catalogue-only row.