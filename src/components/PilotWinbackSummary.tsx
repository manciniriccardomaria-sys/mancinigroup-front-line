import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, PhoneCall } from 'lucide-react';
import { auth } from '../firebase';
import type { CallTask } from '../callCenter';
import { getAuthorizedEmployee } from '../constants';
import { subscribeToCallTasksForEmployee } from '../callTaskSubscriptions';
import { getNegotiationErrorMessage } from '../negotiations';
import { correctPilotWinbackOutcome, createWinbackCallId, recordPilotWinbackCall, subscribeToPilotWinbackCalls } from '../pilotWinback';
import { summarizeWinbackCalls, WINBACK_OUTCOMES, type PilotWinbackCall, type WinbackOutcome } from '../pilotWinbackModel';

export default function PilotWinbackSummary({ date, today }: { date: string; today: string }) {
  const [calls, setCalls] = useState<PilotWinbackCall[]>([]);
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tasksError, setTasksError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [taskId, setTaskId] = useState('');
  const [outcome, setOutcome] = useState<WinbackOutcome>('reached');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const pendingId = useRef('');
  const uid = auth.currentUser?.uid || '';
  useEffect(() => subscribeToPilotWinbackCalls(data => {
    setCalls(data); setLoading(false); setLoadError('');
  }, () => { setLoadError('Registro Winback non disponibile.'); setLoading(false); }), []);
  useEffect(() => {
    const employee = getAuthorizedEmployee(auth.currentUser?.email);
    return subscribeToCallTasksForEmployee(employee?.sourceCodes || [], uid, data => {
      setTasks(data.filter(task => task.category === 'winback'));
      setTasksLoading(false); setTasksError('');
    }, () => { setTasksError('Elenco chiamate non disponibile.'); setTasksLoading(false); });
  }, [uid]);
  const summary = useMemo(() => summarizeWinbackCalls(calls, uid, date), [calls, uid, date]);
  const dailyCalls = calls.filter(call => call.calledDate === date).sort((a, b) => a.clientName.localeCompare(b.clientName, 'it'));
  const saveCall = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    try {
      pendingId.current ||= createWinbackCallId();
      await recordPilotWinbackCall(pendingId.current, taskId, outcome);
      pendingId.current = ''; setTaskId('');
    } catch (error) { setSaveError(getNegotiationErrorMessage(error)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const correctOutcome = async (id: string, value: WinbackOutcome) => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setSaveError('');
    try { await correctPilotWinbackOutcome(id, value); }
    catch (error) { setSaveError(getNegotiationErrorMessage(error)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  return (
    <aside aria-label="Riepilogo Winback" className="relative w-full lg:w-[260px] lg:shrink-0 rounded-lg border border-blue-200 bg-blue-50/60">
      <button type="button" aria-expanded={expanded} aria-controls="pilot-winback-register" onClick={() => setExpanded(value => !value)} className="w-full p-2 text-left flex items-center gap-2 rounded-lg hover:bg-blue-100/50">
        <PhoneCall size={16} className="text-[#003781] shrink-0" />
        <span className="flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-bold text-[#003781]">Winback · {date === today ? 'oggi' : date.split('-').reverse().join('/')}</span>
            <span role="status" className="text-xs font-bold text-slate-800">{loadError ? 'Non disponibile' : loading ? 'Caricamento…' : `${summary.calls} ${summary.calls === 1 ? 'chiamata' : 'chiamate'}`}</span>
          </span>
          {!loading && !loadError && <span className="block text-[11px] text-slate-600 mt-0.5">{summary.reached} raggiunti · {summary.recovered} recuperati</span>}
        </span>
        <ChevronDown size={16} className={`mt-1 text-blue-700 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && <div id="pilot-winback-register" className="border border-blue-200 rounded-lg bg-white p-3 space-y-3 lg:absolute lg:right-0 lg:top-full lg:z-20 lg:mt-2 lg:w-96 lg:max-h-[65vh] lg:overflow-y-auto lg:shadow-xl">
        <p className="text-xs text-slate-600">Registra ogni chiamata realmente effettuata. Correggere l’esito mantiene una sola chiamata nel conteggio. Il registro di prova conserva fonte e operatore; le schede operative restano in sola lettura.</p>
        {(loadError || tasksError || saveError) && <p role="alert" className="text-xs text-red-700">{loadError || tasksError || saveError}</p>}
        {date === today && !loadError && <form onSubmit={saveCall} className="space-y-2">
          <label className="block text-xs font-bold text-slate-700">Cliente Winback
            <select required disabled={saving || tasksLoading || Boolean(tasksError)} value={taskId} onChange={event => { setTaskId(event.target.value); pendingId.current = ''; }} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal">
              <option value="">{tasksLoading ? 'Caricamento clienti…' : 'Seleziona cliente'}</option>
              {tasks.map(task => <option key={task.id} value={task.id}>{task.clientName} · {task.sourceCode} · {task.policyNumber}</option>)}
            </select>
          </label>
          {!tasksLoading && !tasksError && tasks.length === 0 && <p className="text-xs text-slate-500">Nessuna chiamata Winback disponibile per le tue fonti o assegnata a te.</p>}
          <label className="block text-xs font-bold text-slate-700">Esito della chiamata
            <select disabled={saving} value={outcome} onChange={event => setOutcome(event.target.value as WinbackOutcome)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm font-normal">
              {WINBACK_OUTCOMES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving || tasksLoading || !taskId || Boolean(tasksError)} className="w-full inline-flex items-center justify-center gap-2 bg-[#003781] text-white text-xs font-bold p-2.5 rounded-lg disabled:opacity-40">{saving && <Loader2 size={14} className="animate-spin" />}Registra chiamata effettuata</button>
        </form>}
        {dailyCalls.length > 0 && <ul className="max-h-64 overflow-y-auto space-y-2" aria-label="Chiamate Winback della giornata">
          {dailyCalls.map(call => <li key={call.id} className="rounded-lg bg-white border border-blue-100 p-2">
            <span className="block text-xs font-bold text-slate-800">{call.clientName}</span>
            <span className="block text-[11px] text-slate-500">Fonte {call.sourceCode}</span>
            <label className="block text-[11px] font-semibold text-slate-600 mt-1">{date === today ? 'Correggi esito' : 'Esito registrato'}
              <select aria-label={`Esito chiamata per ${call.clientName}`} value={call.outcome} disabled={saving || Boolean(loadError) || date !== today} onChange={event => correctOutcome(call.id, event.target.value as WinbackOutcome)} className="mt-1 w-full rounded border border-slate-200 bg-white p-1.5 text-xs">
                {WINBACK_OUTCOMES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </li>)}
        </ul>}
      </div>}
    </aside>
  );
}
