import { useEffect, useState } from 'react';
import { PhoneCall } from 'lucide-react';
import type { CallTask } from '../callCenter';
import { subscribeToCallTasksBySourceCodes } from '../callTaskSubscriptions';
import { auth } from '../firebase';
import { subscribeToPilotWinbackCalls } from '../pilotWinback';
import { summarizeWinbackCalls, WINBACK_OUTCOMES, type PilotWinbackCall } from '../pilotWinbackModel';
import { matchesWinbackCalendarGroup, WINBACK_CALENDAR_GROUPS, type WinbackCalendarGroup } from '../winbackCalendar';

export default function PilotWinbackSummary({ today, sourceCodes, onOpenCalendar }: {
  today: string;
  sourceCodes: readonly string[];
  onOpenCalendar: (group: WinbackCalendarGroup) => void;
}) {
  const [tasks, setTasks] = useState<CallTask[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => subscribeToCallTasksBySourceCodes(sourceCodes, data => {
    setTasks(data.filter(task => task.category === 'winback'));
    setLoadError(false);
  }, () => setLoadError(true)), [sourceCodes]);

  return (
    <aside aria-label="Riepilogo Winback" className="w-full rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-1.5 lg:w-[260px] lg:shrink-0">
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-[#003781]">
        <PhoneCall size={13} aria-hidden="true" />
        Winback · Fonte {sourceCodes.join(', ')}
      </h3>
      <div className="grid grid-cols-3 gap-1">
        {WINBACK_CALENDAR_GROUPS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => onOpenCalendar(id)}
            className="rounded border border-blue-100 bg-white px-1 py-0.5 text-blue-900 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700"
          >
            <span className="block text-sm font-bold tabular-nums">
              {loadError || !tasks ? '–' : tasks.filter(task => matchesWinbackCalendarGroup(task, id, today)).length}
            </span>
            <span className="block text-[11px] leading-tight">{label}</span>
          </button>
        ))}
      </div>
      {loadError && <p role="status" className="mt-1 text-[11px] text-red-700">Conteggi non disponibili.</p>}
    </aside>
  );
}

export function PilotWinbackHistory({ date }: { date: string }) {
  const [calls, setCalls] = useState<PilotWinbackCall[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const uid = auth.currentUser?.uid || '';

  useEffect(() => subscribeToPilotWinbackCalls(data => {
    setCalls(data);
    setLoadError(false);
  }, () => setLoadError(true)), [uid]);

  const dailyCalls = (calls || []).filter(call => call.calledDate === date)
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'it'));
  const summary = summarizeWinbackCalls(dailyCalls, uid, date);

  return (
    <details className="rounded-lg border border-blue-200 bg-blue-50/60 px-2 py-1.5 text-xs lg:w-[260px] lg:shrink-0">
      <summary className="cursor-pointer font-bold text-[#003781]">Registro Winback</summary>
      {loadError ? <p role="status" className="mt-1 text-red-700">Registro Winback non disponibile.</p>
        : !calls ? <p role="status" className="mt-1 text-slate-600">Caricamento…</p>
        : <>
          <p className="mt-1 text-slate-600">{summary.calls} chiamate · {summary.reached} raggiunti · {summary.recovered} recuperati</p>
          {dailyCalls.length > 0 && <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {dailyCalls.map(call => <li key={call.id} className="rounded border border-blue-100 bg-white p-1.5">
              <strong>{call.clientName}</strong>
              <span className="block text-slate-600">Fonte {call.sourceCode} · {WINBACK_OUTCOMES.find(option => option.id === call.outcome)?.label}</span>
            </li>)}
          </ul>}
        </>}
    </details>
  );
}
