// Pure (React-Native-free) helpers for the Tasks screen add-form + FAB logic.
// Extracted so the "add schedule" behaviour can be unit-tested without the RN
// runtime, and so the component stays declarative.

export type Priority = 'P0' | 'P1' | 'P2';

export type ScheduleBucket = 'overdue' | 'today' | 'upcoming' | 'done';

/**
 * Classify a schedule task into the bucket it should render under.
 * Drives requirement: a freshly saved task appears in the correct
 * "今天 / 即将到来" group immediately.
 */
export function classifySchedule(date: string, completed: boolean, today: string): ScheduleBucket {
  if (completed) return 'done';
  if (date < today) return 'overdue';
  if (date === today) return 'today';
  return 'upcoming';
}

/** The add-FAB must be hidden while an add-form is open (otherwise it covers the form). */
export function shouldShowAddFab(adding: boolean): boolean {
  return !adding;
}

/** A schedule can only be submitted when it has a non-blank title. */
export function canSubmitSchedule(title: string): boolean {
  return title.trim().length > 0;
}

export interface ScheduleFormState {
  title: string;
  date: string;
  time: string;
  priority: Priority;
  category: string;
}

export function initialScheduleForm(today: string, defaultCategory: string): ScheduleFormState {
  return { title: '', date: today, time: '', priority: 'P1', category: defaultCategory };
}

/** Reset every transient field (used on cancel and after a successful save). */
export function resetScheduleForm(_prev: ScheduleFormState, today: string, defaultCategory: string): ScheduleFormState {
  return initialScheduleForm(today, defaultCategory);
}
