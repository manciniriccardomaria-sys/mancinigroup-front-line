import { getTaskEffectiveDate, isTaskActionable, type CallTask } from './callCenter';
import { getTaskLastActionDate } from './callHistory';

export const WINBACK_CALENDAR_GROUPS = [
  { id: 'due', label: 'Da effettuare' },
  { id: 'overdue', label: 'Arretrate' },
  { id: 'done', label: 'Fatte' },
] as const;

export type WinbackCalendarGroup = typeof WINBACK_CALENDAR_GROUPS[number]['id'];

export function matchesWinbackCalendarGroup(task: CallTask, group: WinbackCalendarGroup, today: string) {
  if (task.category !== 'winback') return false;
  if (group === 'done') return getTaskLastActionDate(task) === today;

  const effectiveDate = getTaskEffectiveDate(task);
  return Boolean(effectiveDate && isTaskActionable(task, today) &&
    (group === 'due' ? effectiveDate === today : effectiveDate < today));
}
