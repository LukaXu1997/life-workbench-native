// V2.13.0 — Local reminders for tasks (relative lead-time) and habits (daily).
//
// Task reminders store a RELATIVE lead (minutes before the task's own time):
//   0 = on time, 15/30/60/120/180 = minutes before, 1440 = 1 day before.
//   The actual fire time is computed at schedule time: taskDate+taskTime − lead.
//   Recurring tasks therefore inherit the same lead automatically — no shifting
//   needed, since each generated instance recomputes from its own date/time.
//
// Habit reminders store an absolute daily time ('HH:MM') and use a DAILY trigger,
// so a single scheduled notification repeats every day at that time.
//
// Both fields are optional/backward-compatible, so SCHEMA_VERSION stays at 2.
// Notifications are local only (no push). Channels are created on Android 8+.
// All scheduling is best-effort and never blocks app launch or task save.

import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { store } from './store';
import type { Task, Habit } from './types';
import { t } from './i18n';

const CHANNEL_TASK = 'task-reminders';
const CHANNEL_HABIT = 'habit-reminders';

/** Lead-time options (minutes before the task time) offered in the UI. */
export const LEAD_OPTIONS = [0, 15, 30, 60, 120, 180, 1440] as const;
export type LeadMinutes = (typeof LEAD_OPTIONS)[number];

/** Localized label for a lead value, e.g. 30 -> "30分钟前", 0 -> "准时". */
export function leadLabel(min: number): string {
  if (min === 0) return t('plan.lead0');
  if (min === 15) return t('plan.lead15');
  if (min === 30) return t('plan.lead30');
  if (min === 60) return t('plan.lead60');
  if (min === 120) return t('plan.lead120');
  if (min === 180) return t('plan.lead180');
  if (min === 1440) return t('plan.lead1440');
  return `${min} min`;
}

/** Compute the Date a task reminder should fire. Returns null if none is valid. */
export function taskReminderFireTime(task: Task): Date | null {
  if (task.reminder == null || task.completed) return null;
  const timePart = task.time || '09:00';
  const when = new Date(`${task.date}T${timePart}`);
  if (isNaN(when.getTime())) return null;
  return new Date(when.getTime() - task.reminder * 60000);
}

/** Ensure both Android notification channels exist (no-op on iOS). */
export async function ensureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_TASK, {
      name: t('plan.reminder'),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#5B8DEF',
    });
    await Notifications.setNotificationChannelAsync(CHANNEL_HABIT, {
      name: t('plan.habitReminder'),
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#34C759',
    });
  } catch {
    /* best-effort */
  }
}

let handlerSet = false;
/** Install the notification handler so foreground notifications are presented. Idempotent. */
export function ensureNotificationHandler(): void {
  if (handlerSet) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  handlerSet = true;
}

/** Returns true if we have (or just obtained) permission to schedule notifications. */
export async function ensureReminderPermission(): Promise<boolean> {
  if (!Device.isDevice) return false; // simulator/emulator can't show them reliably
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return req.granted;
  } catch {
    return false;
  }
}

/**
 * Schedule a reminder for a single task, firing `task.reminder` minutes before
 * its own time. No-op (returns false) when the task has no reminder, is completed,
 * or the computed fire time is in the past. Requests permission if needed.
 */
export async function scheduleTaskReminder(task: Task): Promise<boolean> {
  const fire = taskReminderFireTime(task);
  if (!fire || fire.getTime() <= Date.now()) return false;
  const allowed = await ensureReminderPermission();
  if (!allowed) return false;
  try {
    const lead = leadLabel(task.reminder as number);
    const title =
      task.title && task.title.trim()
        ? t('plan.reminderTitle', { title: task.title.trim() })
        : t('plan.reminder');
    const when = task.time || '09:00';
    await Notifications.scheduleNotificationAsync({
      identifier: `task-${task.id}`,
      content: {
        title,
        body: t('plan.reminderTimeLead', { time: when, lead }),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        channelId: CHANNEL_TASK,
        date: fire,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Cancel a previously scheduled reminder for a task. Safe if never scheduled. */
export async function cancelTaskReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`task-${id}`);
  } catch {
    /* already gone / never scheduled */
  }
}

/** Schedule a daily habit reminder at habit.reminderTime ('HH:MM'). Returns false if unset. */
export async function scheduleHabitReminder(habit: Habit): Promise<boolean> {
  if (!habit.reminderTime) return false;
  const m = /^(\d{2}):(\d{2})$/.exec(habit.reminderTime);
  if (!m) return false;
  const allowed = await ensureReminderPermission();
  if (!allowed) return false;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `habit-${habit.id}`,
      content: {
        title: habit.name,
        body: t('plan.habitReminderBody'),
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        channelId: CHANNEL_HABIT,
        hour: Number(m[1]),
        minute: Number(m[2]),
      },
    });
    return true;
  } catch {
    return false;
  }
}

/** Cancel a previously scheduled daily habit reminder. Safe if never scheduled. */
export async function cancelHabitReminder(id: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(`habit-${id}`);
  } catch {
    /* already gone / never scheduled */
  }
}

/**
 * Re-sync all scheduled reminders from the current task + habit stores.
 * Cancels every scheduled notification first, then re-schedules all valid ones.
 * Safe to call on cold start and on foreground resume. Never throws.
 */
export async function rescheduleAll(): Promise<void> {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    /* ignore */
  }
  try {
    const tasks = await store.getTasks();
    for (const task of tasks) {
      await scheduleTaskReminder(task);
    }
    const habits = await store.getHabits();
    for (const habit of habits) {
      await scheduleHabitReminder(habit);
    }
  } catch {
    /* ignore */
  }
}
