// UI fixes unit tests — status-bar appearance + Tasks add-form / FAB logic.
// React-Native-free; run under plain Node via scripts/import-test-runner.js.
//
// All sample data below is DE-IDENTIFIED: placeholder dates/categories only.

import { isDarkFromMode, barStyleFor } from './statusBar';
import {
  classifySchedule,
  shouldShowAddFab,
  canSubmitSchedule,
  initialScheduleForm,
  resetScheduleForm,
} from './uiTasks';

let pass = 0;
let fail = 0;
const fails: string[] = [];
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
  } else {
    fail++;
    fails.push(name);
    console.log('  FAIL: ' + name);
  }
}
function eq(name: string, a: unknown, b: unknown) {
  ok(name + ` (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, a === b);
}

// ---------------------------------------------------------- status bar theme
console.log('--- statusBar ---');
// isDarkFromMode: explicit dark / light win; system defers to the OS setting.
ok('explicit dark is dark', isDarkFromMode('dark', false) === true);
ok('explicit light is not dark', isDarkFromMode('light', true) === false);
ok('system + os dark is dark', isDarkFromMode('system', true) === true);
ok('system + os light is not dark', isDarkFromMode('system', false) === false);

// barStyle: light theme -> dark-content (dark icons); dark theme -> light-content.
eq('light theme barStyle', barStyleFor(false), 'dark-content');
eq('dark theme barStyle', barStyleFor(true), 'light-content');

// ---------------------------------------------------------- tasks add-form
console.log('--- tasks add-form / FAB ---');
// FAB must be hidden while the add-form is open.
ok('fab visible when not adding', shouldShowAddFab(false) === true);
ok('fab hidden when adding', shouldShowAddFab(true) === false);

// Submit is only allowed with a non-blank (trimmed) title.
ok('empty title cannot submit', canSubmitSchedule('') === false);
ok('whitespace-only title cannot submit', canSubmitSchedule('   ') === false);
ok('real title can submit', canSubmitSchedule('买菜') === true);

// A freshly saved task lands in the right bucket immediately.
eq('completed -> done', classifySchedule('2026-08-28', true, '2026-08-28'), 'done');
eq('past date -> overdue', classifySchedule('2026-08-20', false, '2026-08-28'), 'overdue');
eq('today -> today', classifySchedule('2026-08-28', false, '2026-08-28'), 'today');
eq('future -> upcoming', classifySchedule('2026-09-01', false, '2026-08-28'), 'upcoming');

// initialScheduleForm / resetScheduleForm return the cleared baseline.
{
  const init = initialScheduleForm('2026-08-28', '工作');
  eq('init title empty', init.title, '');
  eq('init date = today', init.date, '2026-08-28');
  eq('init priority P1', init.priority, 'P1');
  eq('init category passed', init.category, '工作');
  const dirty = { title: 'x', date: '2026-09-09', time: '08:00', priority: 'P0' as const, category: '餐饮' };
  const cleared = resetScheduleForm(dirty, '2026-08-28', '工作');
  eq('reset clears title', cleared.title, '');
  eq('reset restores today', cleared.date, '2026-08-28');
  eq('reset restores P1', cleared.priority, 'P1');
  eq('reset restores default category', cleared.category, '工作');
}

// ---------------------------------------------------------------- summary
console.log(`\nUI tests: ${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.log('FAILED: ' + fails.join(' | '));
  process.exit(1);
}
process.exit(0);
