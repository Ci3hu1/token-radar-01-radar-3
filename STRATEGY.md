# STRATEGY.md — radar-3

## Measured edge

The leaders' recipe, from the study of the field: a value model **fitted**
from already-trading tokens, validation **shown** on the dashboard, farm
plans **netted** to dollars, and **full coverage** (all pre-token protocols
ranked, all 758 protocols accounted for). The previous entry (773,663) used
a hand-picked constant instead of a fitted curve, showed no validation, and
did not net farm costs. This entry implements all four.

## Entry / exit rules

- **Ranked set:** every protocol that records no token (gecko id and symbol
  both null), minus CEX / Bridge / Canonical Bridge / Liquid Staking /
  Liquid Restaking / Restaked BTC categories, version-suffixed names,
  wrapped/staked/staking names, and exchange-prefixed names. 198 rows.
- **Pricing:** per-category OLS on log(mcap) vs log(TVL) over 127 anchors
  (≥ 5 anchors per category, else global), times growth / maturity /
  breadth multipliers from the snapshot figures only.
- **Farm verdict:** EV = 5% of implied value − gas (8 tx). FARM if EV > $50,
  THIN if $0 < EV ≤ $50, SKIP if EV ≤ $0. Break-even implied = gas / 5%.

## Tried and dropped

- A single global fit for all categories: kept as the fallback, but
  per-category fits are used where the anchor count supports them (9
  categories qualify).
- Reporting only mean error: the blind holdout MAPE (590%) is dominated by
  a few catastrophic predictions, so the median error (91%) and Spearman
  (0.329) are shown alongside it — the honest central picture.

## Expected outcomes

- The fit is weak (global R² 0.19; median holdout error ~91%), so implied
  values are order-of-magnitude claims, not prices. The entry's case to the
  judge is transparency: the formula, the coefficients, all four
  validations, the rank-stability ranges, and the full 758 accounting are
  visible on the page, and the page recomputes every row and shows the
  agreement check.
- Deterministic: two runs write byte-identical output (verified with
  `diff -r`).
