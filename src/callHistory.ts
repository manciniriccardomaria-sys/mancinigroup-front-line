import type { CallTask } from './callCenter';
import { getItalyDate } from './lib/utils';

export function isTaskInHistory(task: Partial<CallTask>, today: string): boolean {
  return Boolean(
    (task.status && task.status !== 'da_chiamare') ||
    task.calledDate ||
    (task.dueDate && task.dueDate < today) ||
    (task.eventDate && task.eventDate < today)
  );
}

export function canDiscardUnworkedTask(task: Partial<CallTask>, today: string): boolean {
  return task.status === 'da_chiamare' && Boolean(task.dueDate && task.dueDate > today) &&
    !task.calledDate && !task.assignedToUid && !task.updatedByUid &&
    !isTaskInHistory(task, today);
}

export function getTaskLastActionDate(task: CallTask): string {
  if (task.status === 'da_chiamare') return '';
  if (task.calledDate) return task.calledDate;

  const value = task.updatedAt;
  if (value && typeof value === 'object' && 'toDate' in value &&
    typeof value.toDate === 'function') {
    const date = value.toDate();
    if (date instanceof Date && !Number.isNaN(date.getTime())) return getItalyDate(date);
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return getItalyDate(date);
  }
  return '';
}

export function getTaskCalendarDates(task: CallTask, today: string, actionable: boolean): string[] {
  // La programmazione originale resta consultabile anche dopo un esito o un richiamo.
  return [...new Set([
    task.dueDate,
    task.status === 'da_richiamare' ? task.callbackDate : '',
    getTaskLastActionDate(task),
    actionable ? today : '',
  ].filter(Boolean))];
}
