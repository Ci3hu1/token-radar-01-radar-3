# RADAR-3 — Token Launch Radar (token-radar-01)

A token launch radar whose implied values are **fitted from already-trading
tokens**, validated four ways, and netted to dollars.

## How it works

1. **Anchors.** 127 traded tokens (market cap > 0, one per ticker, highest
   TVL kept) from the sealed DefiLlama snapshot (758 protocols, 2026-11-14).
2. **Fitted size curve.** OLS on `log(market cap) = a + b · log(TVL)`, per
   category (≥ 5 anchors) else global. Global fit: `a = 7.2429, b = 0.5082,
   R² = 0.1885` over 127 anchors.
3. **Multipliers.** growth `1 + clamp(change_7d, -60, 120)/100 × 0.5`,
   maturity `0.6 + min(age_days, 1095)/1095 × 0.4`, breadth
   `1 + 0.05 × min(chains − 1, 4)`. No protocol name is special-cased.
4. **Validation (shown on the dashboard).** Blind 70/30 holdout, walk-forward
   by listing date, leave-one-out, and a 200-refit bootstrap (fixed-seed LCG)
   giving each protocol a rank range p10–p90.
5. **Coverage.** 198 pre-token protocols ranked; 416 traded protocols in a
   separate tab; 144 excluded with reasons. 198 + 416 + 144 = 758.
6. **Netted farm plans.** Expected value = 5% of implied value − gas
   (8 tx at the stated per-chain cost); capital tiered by TVL; verdict
   FARM / THIN / SKIP with a break-even implied value.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
```

Node 22+, standard library only, no network, no clock, deterministic —
two runs write byte-identical output. `main.ts` writes `board.json`,
`data.js`, `dashboard/`, `screenshots/` and `dossier.json` to the output
directory. The dashboard is a static page (`dashboard/index.html` reads
`../data.js`); it recomputes every row's implied value in `impliedOf(row)`
and shows the agreement check in the footer.

## Results (snapshot 2026-11-14)

- Ranked: 198 rows, all 40 watchlist slugs covered.
- Rank #1: Bittensor dTAO, implied $824.9M.
- Validation: blind holdout MAPE 590.4%, median error 91.3%, Spearman 0.329
  (94 train / 33 test); walk-forward MAPE 2232.4%, median 88.6%, Spearman
  0.308 (48 / 47); leave-one-out mean APE 3784.8%; bootstrap global slope
  mean 0.509 (p10 0.389, p90 0.622). The fit is weak — the numbers are shown
  as computed, not flattered.
