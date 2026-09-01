// Standardize — normalize a parsed ImportCandidate into a consistent shape the
// preview/commit stages can rely on.
//
// KEY RULES (from IMPLEMENTATION_PLAN §4 / R2):
//   * The "orig" amount/currency is the source-row reality (e.g. MYR sen, CNY fen).
//     We always anchor `origAmountMinor/origCurrency` so downstream matchers have a
//     single canonical value to compare.
//   * If the FILE already carries a real settlement (historical rate from the bank
//     statement), we KEEP it as `settle*`. We NEVER overwrite it with the current
//     live FX rate.
//   * If there is NO file settlement, we compute `predictedSettleMinor` as a
//     DISPLAY-ONLY estimate (labelled "约" in the UI) and leave `settleAmountMinor`
//     UNSET. The current rate is never written into historical facts.
//
// RN-free, pure.

import type { ImportCandidate } from './models';
import type { Currency } from '../types';
import { convertMinor } from '../money';

export interface StandardizedCandidate extends ImportCandidate {
  origAmountMinor: number;
  origCurrency: Currency;
  /** DISPLAY-ONLY estimate ("约"). Never persisted as a settle fact (R2). */
  predictedSettleMinor?: number;
}

export interface StandardizeOptions {
  /** cnyPerMyr * 1e6, for the MYR->CNY display estimate only. */
  rateScaled?: number;
}

export function standardize(c: ImportCandidate, opts: StandardizeOptions = {}): StandardizedCandidate {
  const origAmountMinor = c.origAmountMinor ?? c.amountMinor;
  const origCurrency = c.origCurrency ?? c.currency;

  // Did the file itself provide a real settlement (historical bank rate)?
  const hasFileSettle =
    c.settleAmountMinor != null &&
    c.settleCurrency != null &&
    (c.settleCurrency !== origCurrency || c.settleAmountMinor !== origAmountMinor);

  // Display-only estimate for cross-currency MYR rows. Never written to settle.
  let predictedSettleMinor: number | undefined;
  if (!hasFileSettle && origCurrency === 'MYR' && opts.rateScaled && opts.rateScaled > 0) {
    predictedSettleMinor = convertMinor(origAmountMinor, 'MYR', opts.rateScaled);
  }

  return {
    ...c,
    origAmountMinor,
    origCurrency,
    // Intentionally do NOT set settleAmountMinor/fxRate from the live rate (R2).
    predictedSettleMinor,
  };
}
