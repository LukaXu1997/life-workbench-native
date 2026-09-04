// @ts-nocheck
// Pure unit tests for the auto-booking decision logic (Steps 3-6, 8-downgrade).
// RN-free; transpiled by scripts/automation-test-runner.js and run under plain Node.
// (bookPendingTransaction / undoAutoBook / repairHalfBooked are store-bound wrappers
// covered by typecheck + the app, exactly like confirmStore / quickAddStore.)

const auto = require('./automation');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log('  x ' + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

const APP = 'my.com.tngdigital.ewallet';
const SIG = auto.merchantSignature('Starbucks #88213'); // 'starbucks'

function cand(over) {
  return Object.assign(
    {
      id: 'c_' + Math.random().toString(36).slice(2),
      sourceType: 'notification',
      sourceApp: APP,
      merchant: 'Starbucks #88213',
      kind: 'expense',
      currency: 'MYR',
      amountMinor: 1234,
      accountHint: 'acc1',
      suggestedAccountId: 'acc1',
      suggestedCategory: '餐饮',
      confidence: 0.99,
      confidenceDetail: { amount: 0.99, direction: 1, account: 1, category: 1, merchant: 0.99, duplicateRisk: 0 },
    },
    over
  );
}

function rule(over) {
  const ts = '2026-09-01T00:00:00.000Z';
  return Object.assign(
    {
      id: 'r_' + Math.random().toString(36).slice(2),
      name: 'test',
      enabled: true,
      priority: 100,
      conditions: {},
      actions: {},
      stats: { matchedCount: 0, confirmedUnchangedCount: 0, correctedCount: 0, autoBookedCount: 0, autoBookUndoneCount: 0 },
      createdAt: ts,
      updatedAt: ts,
    },
    over
  );
}

function fb(over) {
  return Object.assign(
    {
      candidateId: 'c1',
      sourceApp: APP,
      merchantSignature: SIG,
      suggestedDirection: 'expense',
      confirmedAt: '2026-09-01T00:00:00.000Z',
    },
    over
  );
}

const ON_SETTINGS = { enabled: true, expenseLimitMinor: 5000, incomeLimitMinor: 0 };

// ---- merchantSignature collapses order/ref numbers & strips prefixes (Step 4) ----
eq(auto.merchantSignature('Starbucks #88213'), auto.merchantSignature('Starbucks #99102'), 'sig: order numbers collapse');
eq(auto.merchantSignature('Starbucks #88213'), 'starbucks', 'sig: digits + spaces stripped');
eq(auto.merchantSignature('Payment To Grab #123'), 'grab', 'sig: prefix + digits stripped');
eq(auto.merchantSignature('12345'), '', 'sig: digits-only -> empty (excluded from learning)');

// ---- matchRule ----
{
  const r = rule({
    conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' },
    actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true },
  });
  ok(auto.matchRule(cand(), r), 'matchRule: app+sig+direction hit');
  ok(!auto.matchRule(cand({ kind: 'income' }), r), 'matchRule: direction mismatch -> no match');
  ok(!auto.matchRule(cand({ sourceApp: 'other' }), r), 'matchRule: app mismatch -> no match');
}

// ---- sortRules priority desc ----
{
  const a = rule({ id: 'a', priority: 10 });
  const b = rule({ id: 'b', priority: 50 });
  const sorted = auto.sortRules([a, b]);
  eq(sorted[0].id, 'b', 'sortRules: higher priority first');
}

// ---- applyRules fills account/category from matched autoBook rule (Step 3/5) ----
{
  const r = rule({
    conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' },
    actions: { accountId: 'acc9', categoryId: '交通', autoBook: true },
  });
  const res = auto.applyRules(cand(), [r]);
  ok(res.canAutoBook, 'applyRules: autoBook rule -> canAutoBook true');
  eq(res.fill.accountId, 'acc9', 'applyRules: fills accountId from rule');
  eq(res.fill.categoryId, '交通', 'applyRules: fills categoryId from rule');
  eq(res.matchedRuleIds.length, 1, 'applyRules: records matched rule id');
}

// ---- ignore rule prevents auto-book (Step 3) ----
{
  const r = rule({
    conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' },
    actions: { ignore: true, accountId: 'acc9', categoryId: '交通' },
  });
  const res = auto.applyRules(cand(), [r]);
  ok(res.ignore, 'applyRules: ignore rule flagged');
  ok(!res.canAutoBook, 'applyRules: ignore -> cannot auto-book');
}

// ---- conflict on account/category -> cannot auto-book (Step 3) ----
{
  const r1 = rule({ id: 'r1', priority: 200, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc9', categoryId: '交通', autoBook: true } });
  const r2 = rule({ id: 'r2', priority: 100, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc8', categoryId: '交通', autoBook: true } });
  const res = auto.applyRules(cand(), [r1, r2]);
  ok(res.conflict, 'applyRules: conflicting accounts -> conflict true');
  ok(!res.canAutoBook, 'applyRules: conflict -> cannot auto-book');
}

// ---- alwaysConfirm beats autoBook (Step 3) ----
{
  const autoR = rule({ id: 'a', priority: 100, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc9', categoryId: '交通', autoBook: true } });
  const confR = rule({ id: 'c', priority: 300, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc9', categoryId: '交通', alwaysConfirm: true } });
  const res = auto.applyRules(cand(), [autoR, confR]);
  ok(res.alwaysConfirm, 'applyRules: alwaysConfirm flagged');
  ok(!res.canAutoBook, 'applyRules: alwaysConfirm overrides autoBook');
}

// ---- buildRuleSuggestion (Step 5) ----
{
  const hist = [
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-01T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-02T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-03T00:00:00.000Z' }),
  ];
  const s = auto.buildRuleSuggestion(cand(), hist, []);
  ok(s !== null, 'suggestion: 3 identical confirmations -> suggest');
  eq(s && s.conditions.normalizedMerchantEquals, SIG, 'suggestion: stores merchant signature');
  eq(s && s.actions.accountId, 'acc1', 'suggestion: account from history');
  eq(s && s.actions.categoryId, '餐饮', 'suggestion: category from history');
}

// 2 confirmations -> no suggestion
ok(auto.buildRuleSuggestion(cand(), [fb(), fb()], []) === null, 'suggestion: 2 confirmations -> none');

// 3 confirmations but differing category -> no suggestion
{
  const hist = [
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-01T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '购物', confirmedAt: '2026-09-02T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-03T00:00:00.000Z' }),
  ];
  ok(auto.buildRuleSuggestion(cand(), hist, []) === null, 'suggestion: 3 but inconsistent category -> none');
}

// existing identical rule -> no suggestion
{
  const hist = [
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-01T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-02T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-03T00:00:00.000Z' }),
  ];
  const existing = [rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮' } })];
  ok(auto.buildRuleSuggestion(cand(), hist, existing) === null, 'suggestion: existing identical rule -> none');
}

// existing ignore rule for signature -> no suggestion
{
  const hist = [
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-01T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-02T00:00:00.000Z' }),
    fb({ finalAccountId: 'acc1', finalCategoryId: '餐饮', confirmedAt: '2026-09-03T00:00:00.000Z' }),
  ];
  const existing = [rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { ignore: true } })];
  ok(auto.buildRuleSuggestion(cand(), hist, existing) === null, 'suggestion: existing ignore rule -> none');
}

// empty signature merchant -> no suggestion
ok(auto.buildRuleSuggestion(cand({ merchant: '12345' }), [fb(), fb(), fb()], []) === null, 'suggestion: empty signature -> none');

// ---- canAutoBook (Step 6) ----
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const cab = auto.canAutoBook(cand(), apply, ON_SETTINGS);
  ok(cab.allowed, 'canAutoBook: clean expense with autoBook rule -> allowed');
}

// disabled settings -> blocked
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  ok(!auto.canAutoBook(cand(), apply, { enabled: false, expenseLimitMinor: 5000, incomeLimitMinor: 0 }).allowed, 'canAutoBook: settings disabled -> blocked');
}

// conflict -> blocked
{
  const r1 = rule({ priority: 200, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc9', categoryId: '交通', autoBook: true } });
  const r2 = rule({ priority: 100, conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc8', categoryId: '交通', autoBook: true } });
  const apply = auto.applyRules(cand(), [r1, r2]);
  const cab = auto.canAutoBook(cand(), apply, ON_SETTINGS);
  ok(!cab.allowed, 'canAutoBook: conflict -> blocked');
  eq(cab.reasons[0], 'rule_conflict', 'canAutoBook: conflict reason');
}

// amount confidence below 0.98 -> blocked
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const low = cand({ confidence: 0.95, confidenceDetail: { amount: 0.95, direction: 1, account: 1, category: 1, merchant: 0.95, duplicateRisk: 0 } });
  ok(!auto.canAutoBook(low, apply, ON_SETTINGS).allowed, 'canAutoBook: amount conf < 0.98 -> blocked');
}

// duplicate risk above 0.10 -> blocked
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const dup = cand({ confidenceDetail: { amount: 0.99, direction: 1, account: 1, category: 1, merchant: 0.99, duplicateRisk: 0.2 } });
  ok(!auto.canAutoBook(dup, apply, ON_SETTINGS).allowed, 'canAutoBook: duplicate risk > 0.10 -> blocked');
}

// over expense limit -> blocked
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const big = cand({ amountMinor: 6000 });
  ok(!auto.canAutoBook(big, apply, { enabled: true, expenseLimitMinor: 5000, incomeLimitMinor: 0 }).allowed, 'canAutoBook: over expense limit -> blocked');
}

// transfer/refund/repayment/unknown -> blocked (Step 6)
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const unknown = cand({ kind: 'unknown' });
  ok(!auto.canAutoBook(unknown, apply, ON_SETTINGS).allowed, 'canAutoBook: unknown direction -> blocked (no transfer/refund/repayment)');
}

// already booked -> blocked (idempotency guard, Step 7)
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const apply = auto.applyRules(cand(), [r]);
  const booked = cand({ createdTxnId: 'txn_x' });
  const cab = auto.canAutoBook(booked, apply, ON_SETTINGS);
  ok(!cab.allowed, 'canAutoBook: already booked -> blocked (idempotency)');
  eq(cab.reasons[0], 'already_booked', 'canAutoBook: already_booked reason');
}

// ---- old-data compatibility: candidate missing new fields must not crash (Step 10) ----
{
  const r = rule({ conditions: { sourceApp: APP, normalizedMerchantEquals: SIG, direction: 'expense' }, actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true } });
  const legacy = { id: 'old', sourceApp: APP, merchant: 'Starbucks #1', kind: 'expense', currency: 'MYR', amountMinor: 1234, suggestedAccountId: 'acc1', suggestedCategory: '餐饮', confidence: 0.99 };
  const apply = auto.applyRules(legacy, [r]);
  ok(apply.canAutoBook, 'old data: applyRules works without confidenceDetail/matchedRuleIds');
  ok(auto.canAutoBook(legacy, apply, ON_SETTINGS).allowed, 'old data: canAutoBook falls back to candidate.confidence');
}

// ---- undo downgrade (Step 8) ----
{
  const r = rule({ actions: { accountId: 'acc1', categoryId: '餐饮', autoBook: true }, stats: { matchedCount: 2, confirmedUnchangedCount: 1, correctedCount: 0, autoBookedCount: 1, autoBookUndoneCount: 0 } });
  const d = auto.downgradeRuleOnUndo(r);
  ok(d.actions.autoBook === false, 'undo: rule downgraded to fill-only');
  eq(d.stats.autoBookUndoneCount, 1, 'undo: undo counter incremented');
}

console.log(`\nAuto-booking tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
