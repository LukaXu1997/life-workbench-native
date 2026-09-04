// @ts-nocheck
// Pure aggregation tests for the Plan module (timeline / recurring / habit link).
// RN-free; transpiled by scripts/plan-test-runner.js and run under plain Node.

const plan = require('../plan');

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  ✗ ' + msg);
  }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`);
}

// Minimal fixtures. Task defaults make a valid one-off; Habit defaults to a check.
function task(over) {
  return Object.assign(
    {
      id: 't_' + Math.random().toString(36).slice(2),
      title: 'task',
      date: '2026-09-10',
      time: '',
      priority: 'P1',
      category: '',
      note: '',
      completed: false,
      createdAt: 0,
    },
    over
  );
}
function habit(over) {
  return Object.assign(
    {
      id: 'h_' + Math.random().toString(36).slice(2),
      name: 'habit',
      type: 'check',
      target: 1,
      unit: '',
      records: {},
      createdAt: 0,
    },
    over
  );
}

const TODAY = '2026-09-01';

// ---- listRecurring: filters none / completed ----
{
  const tasks = [
    task({ repeat: 'none' }),
    task({ repeat: 'daily', date: '2026-09-05' }),
    task({ repeat: 'weekly', date: '2026-09-05', completed: true }),
    task({ date: '2026-09-05' }), // no repeat field
  ];
  eq(plan.listRecurring(tasks).length, 1, 'listRecurring: only active non-none repeat counted');
}

// ---- addPeriod: advances by frequency ----
{
  eq(plan.addPeriod('2026-09-01', 'daily'), '2026-09-02', 'addPeriod daily +1 day');
  eq(plan.addPeriod('2026-09-01', 'weekly'), '2026-09-08', 'addPeriod weekly +7 days');
  eq(plan.addPeriod('2026-01-31', 'monthly'), '2026-03-03', 'addPeriod monthly overflows short month (JS setMonth parity)');
  eq(plan.addPeriod('2026-02-28', 'yearly'), '2027-02-28', 'addPeriod yearly +1 year');
  eq(plan.addPeriod('2026-09-01', 'none'), '2026-09-01', 'addPeriod none is identity');
}

// ---- nextDue: future / past / overdue / null ----
{
  const fut = task({ repeat: 'weekly', date: '2026-09-08' });
  const nd = plan.nextDue(fut, TODAY);
  eq(nd.date, '2026-09-08', 'nextDue future: stored date is next due');
  eq(nd.daysLeft, 7, 'nextDue future: 7 days left');
  eq(nd.overdue, false, 'nextDue future: not overdue');

  const past = task({ repeat: 'daily', date: '2026-08-30' });
  const nd2 = plan.nextDue(past, TODAY);
  eq(nd2.date, '2026-09-01', 'nextDue past daily: advanced to today');
  eq(nd2.daysLeft, 0, 'nextDue past daily: 0 days left');
  eq(nd2.overdue, true, 'nextDue past daily: overdue (base date already passed)');

  const pastMonth = task({ repeat: 'monthly', date: '2026-07-15' });
  const nd3 = plan.nextDue(pastMonth, TODAY);
  eq(nd3.date, '2026-09-15', 'nextDue past monthly: advanced to next monthly occurrence');
  eq(nd3.overdue, true, 'nextDue past monthly: overdue (base date already passed)');

  const none = task({ date: '2026-09-10' });
  eq(plan.nextDue(none, TODAY), null, 'nextDue none: returns null');
}

// ---- habitCalendarMap: counts per date, excludes 0 ----
{
  const hs = [
    habit({ records: { '2026-09-01': 1, '2026-09-02': 1 } }),
    habit({ records: { '2026-09-01': 1, '2026-09-03': 0 } }), // value 0 must be ignored
  ];
  const m = plan.habitCalendarMap(hs);
  eq(m['2026-09-01'], 2, 'habitCalendarMap: two habits recorded on 09-01');
  eq(m['2026-09-02'], 1, 'habitCalendarMap: one habit on 09-02');
  ok(m['2026-09-03'] === undefined, 'habitCalendarMap: value 0 excluded');
}

// ---- timelineGroups: buckets + sorting + exclusions ----
{
  const tl = [
    task({ date: '2026-08-30' }), // past -> excluded
    task({ date: '2026-09-01', completed: true }), // completed -> excluded
    task({ date: '2026-09-01', time: '08:00' }),
    task({ date: '2026-09-01', time: '09:00' }),
    task({ date: '2026-09-02' }), // tomorrow
    task({ date: '2026-09-05' }), // thisWeek
    task({ date: '2026-12-25' }), // later
  ];
  const groups = plan.timelineGroups(tl, TODAY);
  eq(groups.length, 4, 'timelineGroups: 4 non-empty buckets');
  eq(groups[0].key, 'today', 'timelineGroups: first bucket is today');
  eq(groups[0].items.length, 2, 'timelineGroups: today has 2 items');
  eq(groups[0].items[0].time, '08:00', 'timelineGroups: today sorted by time asc');
  eq(groups[1].key, 'tomorrow', 'timelineGroups: second bucket is tomorrow');
  eq(groups[2].key, 'thisWeek', 'timelineGroups: third bucket is thisWeek');
  eq(groups[3].key, 'later', 'timelineGroups: fourth bucket is later');
  const total = groups.reduce((s, g) => s + g.items.length, 0);
  eq(total, 5, 'timelineGroups: 5 items total (past + completed excluded)');
}

console.log(`\nPlan module tests: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
