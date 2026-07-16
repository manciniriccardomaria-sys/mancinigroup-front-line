import React, { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { it } from 'date-fns/locale';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  HandHelping,
  Phone,
  Search,
  UserCheck,
} from 'lucide-react';
import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { getAuthorizedEmployee } from '../constants';
import {
  Campaign,
  CallTask,
  getTaskEffectiveDate,
  isTaskActionable,
  isTaskBeforeTrackingStart,
  isTaskCampaignWindowOpen,
  isTaskClosed,
  isTaskExpired,
} from '../callCenter';
import {
  CALL_STATUSES,
  CallStatusId,
  isCallCategoryEnabled,
} from '../callWorkflowConfig';
import { getItalyDate } from '../lib/utils';
import CallCategoryFilter, {
  CallCategorySelection,
  CampaignFilterOption,
} from './CallCategoryFilter';

type SourceMode = 'mine' | 'help';

export default function EmployeeCallCalendar() {
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(() => getItalyDate());
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(parseISO(getItalyDate())));
  const [sourceMode, setSourceMode] = useState<SourceMode>('mine');
  const [selectedHelpSources, setSelectedHelpSources] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<CallCategorySelection[]>([]);
  const [savingTaskId, setSavingTaskId] = useState('');
  const [callbackTaskId, setCallbackTaskId] = useState('');
  const [callbackDate, setCallbackDate] = useState('');
  const [error, setError] = useState('');

  const employee = getAuthorizedEmployee(auth.currentUser?.email);
  const ownSourceCodes = employee?.sourceCodes || [];
  const canHelpOtherSources = employee?.canHelpOtherSources !== false;
  const currentUid = auth.currentUser?.uid || '';
  const currentEmail = auth.currentUser?.email || '';
  const currentName = employee?.name || auth.currentUser?.displayName || 'Dipendente';
  const today = getItalyDate();

  useEffect(() => {
    return onSnapshot(collection(db, 'call_tasks'), snapshot => {
      setTasks(snapshot.docs.map(item => ({
        id: item.id,
        ...item.data(),
      } as CallTask)));
      setLoading(false);
      setError('');
    }, snapshotError => {
      console.error('Error loading call calendar:', snapshotError);
      setError('Non è stato possibile caricare il calendario chiamate.');
      setLoading(false);
    });
  }, []);

  useEffect(() => onSnapshot(collection(db, 'campaigns'), snapshot => {
    setCampaigns(snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
    } as Campaign)));
  }), []);

  useEffect(() => {
    if (!canHelpOtherSources && sourceMode === 'help') {
      setSourceMode('mine');
      setSelectedHelpSources([]);
    }
  }, [canHelpOtherSources, sourceMode]);

  const activeCampaigns = useMemo(
    () => campaigns.filter(campaign => campaign.active),
    [campaigns]
  );
  const activeCampaignIds = useMemo(
    () => new Set(activeCampaigns.map(campaign => campaign.id)),
    [activeCampaigns]
  );

  const enabledTasks = useMemo(
    () => tasks.filter(task =>
      isCallCategoryEnabled(task.category) &&
      (
        task.category !== 'campagna' ||
        Boolean(task.campaignId && activeCampaignIds.has(task.campaignId))
      )
    ),
    [tasks, activeCampaignIds]
  );

  const availableHelpSources = useMemo(() => {
    const sources = new Map<string, { key: string; code: string; name: string }>();

    enabledTasks.forEach(task => {
      if (
        ownSourceCodes.some(code => code === task.sourceCode) ||
        isTaskExpired(task, today) ||
        isTaskBeforeTrackingStart(task)
      ) {
        return;
      }

      const key = getSourceKey(task);
      sources.set(key, {
        key,
        code: task.sourceCode,
        name: task.sourceName,
      });
    });

    return [...sources.values()].sort((first, second) => {
      const codeComparison = first.code.localeCompare(second.code, 'it');
      return codeComparison || first.name.localeCompare(second.name, 'it');
    });
  }, [enabledTasks, ownSourceCodes, today]);

  const modeTasks = useMemo(() => enabledTasks.filter(task => {
    if (isTaskExpired(task, today) || isTaskBeforeTrackingStart(task)) return false;
    const isMine = ownSourceCodes.some(code => code === task.sourceCode);
    if (sourceMode === 'mine') return isMine;
    if (!canHelpOtherSources) return false;
    return !isMine &&
      selectedHelpSources.includes(getSourceKey(task)) &&
      (!task.assignedToUid || task.assignedToUid === currentUid);
  }), [
    enabledTasks,
    ownSourceCodes,
    sourceMode,
    canHelpOtherSources,
    currentUid,
    today,
    selectedHelpSources,
  ]);

  const campaignOptions = useMemo<CampaignFilterOption[]>(
    () => activeCampaigns
      .map(campaign => ({
        id: campaign.id,
        label: campaign.name,
      }))
      .sort((first, second) => first.label.localeCompare(second.label, 'it')),
    [activeCampaigns]
  );

  useEffect(() => {
    setSelectedCategories(previous => previous.filter(selection =>
      !selection.startsWith('campaign:') ||
      activeCampaignIds.has(selection.slice('campaign:'.length))
    ));
  }, [activeCampaignIds]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(visibleMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(visibleMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [visibleMonth]);

  const countsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    modeTasks.forEach(task => {
      if (!matchesCategorySelection(task, selectedCategories)) return;
      const date = getEmployeeCalendarDate(task, today);
      if (!date) return;
      counts.set(date, (counts.get(date) || 0) + 1);
    });
    return counts;
  }, [modeTasks, today, selectedCategories]);

  const filteredTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return modeTasks
      .filter(task => {
        const calendarDate = getEmployeeCalendarDate(task, today);
        if (!calendarDate) return false;

        const isSelectedDay = calendarDate === selectedDate;
        const isOverdue = selectedDate === today && isTaskActionable(task, today);
        const matchesSearch = !normalizedSearch || [
          task.clientName,
          task.phone,
          task.policyNumber,
          task.vehiclePlate,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));

        return (isSelectedDay || isOverdue) &&
          matchesSearch &&
          matchesCategorySelection(task, selectedCategories);
      })
      .sort((first, second) => {
        const firstDate = getEmployeeCalendarDate(first, today) || getTaskEffectiveDate(first);
        const secondDate = getEmployeeCalendarDate(second, today) || getTaskEffectiveDate(second);
        const dateComparison = firstDate.localeCompare(secondDate);
        if (dateComparison !== 0) return dateComparison;
        return first.clientName.localeCompare(second.clientName, 'it');
      });
  }, [modeTasks, selectedDate, today, search, selectedCategories]);

  const overdueCount = modeTasks.filter(task =>
    getTaskEffectiveDate(task) < today && isTaskActionable(task, today)
  ).length;

  const claimTask = async (task: CallTask) => {
    setSavingTaskId(task.id);
    try {
      await updateDoc(doc(db, 'call_tasks', task.id), {
        assignedToUid: currentUid,
        assignedToEmail: currentEmail,
        assignedToName: currentName,
        updatedByUid: currentUid,
        updatedByName: currentName,
        updatedAt: serverTimestamp(),
      });
    } catch (claimError) {
      console.error('Error claiming task:', claimError);
      setError('La chiamata non può essere presa in carico in questo momento.');
    } finally {
      setSavingTaskId('');
    }
  };

  const changeStatus = async (task: CallTask, nextStatus: CallStatusId) => {
    if (nextStatus === 'da_richiamare') {
      setCallbackTaskId(task.id);
      setCallbackDate(task.callbackDate || adjustSuggestedCallback(selectedDate, today));
      return;
    }

    await saveStatus(task, nextStatus);
  };

  const saveStatus = async (
    task: CallTask,
    nextStatus: CallStatusId,
    nextCallbackDate?: string,
  ) => {
    setSavingTaskId(task.id);
    setError('');
    const updatePayload = {
      status: nextStatus,
      callbackDate: nextCallbackDate || deleteField(),
      assignedToUid: currentUid,
      assignedToEmail: currentEmail,
      assignedToName: currentName,
      updatedByUid: currentUid,
      updatedByName: currentName,
      updatedAt: serverTimestamp(),
      ...(nextStatus === 'chiamato'
        ? { calledDate: today }
        : task.calledDate
          ? { calledDate: deleteField() }
          : {}),
    };

    try {
      await updateDoc(doc(db, 'call_tasks', task.id), updatePayload);
      setCallbackTaskId('');
      setCallbackDate('');
    } catch (saveError) {
      console.error('Error updating call status:', saveError);
      setError('Non è stato possibile aggiornare lo stato della chiamata.');
    } finally {
      setSavingTaskId('');
    }
  };

  if (loading) {
    return <div className="py-20 text-center text-slate-500">Caricamento calendario...</div>;
  }

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <CalendarDays size={20} className="text-[#003781]" />
              Calendario chiamate
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              {sourceMode === 'mine'
                ? `Le tue fonti: ${ownSourceCodes.join(', ')}`
                : selectedHelpSources.length > 0
                  ? `${selectedHelpSources.length} fonti selezionate`
                  : 'Seleziona le fonti che vuoi aiutare'}
            </p>
          </div>

          <div className="inline-flex border border-slate-200 p-1 rounded-lg bg-slate-50">
            <button
              type="button"
              onClick={() => setSourceMode('mine')}
              className={`px-3 py-2 rounded-md text-xs font-bold ${
                sourceMode === 'mine'
                  ? 'bg-[#003781] text-white'
                  : 'text-slate-600'
              }`}
            >
              Le mie fonti
            </button>
            {canHelpOtherSources && (
              <button
                type="button"
                onClick={() => setSourceMode('help')}
                className={`px-3 py-2 rounded-md text-xs font-bold flex items-center gap-1.5 ${
                  sourceMode === 'help'
                    ? 'bg-[#003781] text-white'
                    : 'text-slate-600'
                }`}
              >
                <HandHelping size={15} />
                Aiuta altre fonti
              </button>
            )}
          </div>
        </div>

        {canHelpOtherSources && sourceMode === 'help' && (
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-700">Fonti da aiutare</h3>
                <p className="text-xs text-slate-500">
                  Calendario e clienti saranno filtrati sulla selezione.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedHelpSources(
                    availableHelpSources.map(source => source.key)
                  )}
                  className="px-3 py-2 border border-slate-300 bg-white rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100"
                >
                  Seleziona tutte
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedHelpSources([])}
                  disabled={selectedHelpSources.length === 0}
                  className="px-3 py-2 border border-slate-300 bg-white rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40"
                >
                  Azzera
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 max-h-52 overflow-y-auto pr-1">
              {availableHelpSources.map(source => {
                const checked = selectedHelpSources.includes(source.key);
                return (
                  <label
                    key={source.key}
                    className={`flex items-start gap-2 border rounded-lg p-3 cursor-pointer ${
                      checked
                        ? 'border-[#003781] bg-blue-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => setSelectedHelpSources(previous =>
                        checked
                          ? previous.filter(key => key !== source.key)
                          : [...previous, source.key]
                      )}
                      className="mt-0.5 w-4 h-4 accent-[#003781] shrink-0"
                    />
                    <span className="min-w-0">
                      <strong className="block text-sm text-slate-700">{source.code}</strong>
                      <span className="block text-xs text-slate-500 break-words">{source.name}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="p-4 border-b xl:border-b-0 xl:border-r border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={() => setVisibleMonth(month => subMonths(month, 1))}
                className="p-2 hover:bg-slate-100 rounded-lg"
                title="Mese precedente"
              >
                <ChevronLeft size={19} />
              </button>
              <h3 className="font-bold text-slate-800 capitalize">
                {format(visibleMonth, 'MMMM yyyy', { locale: it })}
              </h3>
              <button
                type="button"
                onClick={() => setVisibleMonth(month => addMonths(month, 1))}
                className="p-2 hover:bg-slate-100 rounded-lg"
                title="Mese successivo"
              >
                <ChevronRight size={19} />
              </button>
            </div>

            <div className="grid grid-cols-7 text-center text-[10px] font-bold text-slate-400 mb-1">
              {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((day, index) => (
                <span key={`${day}-${index}`} className="py-1">{day}</span>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {monthDays.map(day => {
                const date = format(day, 'yyyy-MM-dd');
                const count = countsByDate.get(date) || 0;
                const selected = date === selectedDate;

                return (
                  <button
                    key={date}
                    type="button"
                    onClick={() => setSelectedDate(date)}
                    className={`h-10 min-w-0 rounded-md text-xs relative flex items-center justify-center ${
                      selected
                        ? 'bg-[#003781] text-white font-bold'
                        : isSameMonth(day, visibleMonth)
                          ? 'text-slate-700 hover:bg-slate-100'
                          : 'text-slate-300'
                    }`}
                  >
                    {format(day, 'd')}
                    {count > 0 && (
                      <span className={`absolute right-0.5 bottom-0.5 min-w-4 h-4 px-0.5 rounded text-[9px] flex items-center justify-center ${
                        selected
                          ? 'bg-white text-[#003781]'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setSelectedDate(today);
                setVisibleMonth(startOfMonth(parseISO(today)));
              }}
              className="mt-4 w-full border border-slate-300 rounded-lg py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Vai a oggi
            </button>

            {overdueCount > 0 && (
              <div className="mt-3 bg-red-50 border border-red-100 rounded-lg p-3 flex items-center gap-2">
                <Clock3 size={17} className="text-red-600" />
                <div>
                  <p className="text-sm font-bold text-red-700">{overdueCount} arretrate</p>
                  <p className="text-[11px] text-red-600">Visibili selezionando oggi</p>
                </div>
              </div>
            )}
          </div>

          <div className="p-4 min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-slate-800 capitalize">
                  {format(parseISO(selectedDate), 'EEEE d MMMM', { locale: it })}
                </h3>
                <p className="text-xs text-slate-500">
                  {filteredTasks.length} chiamate mostrate
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <label className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Cerca cliente"
                    className="w-full sm:w-56 border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                  />
                </label>
                <CallCategoryFilter
                  selected={selectedCategories}
                  onChange={setSelectedCategories}
                  campaigns={campaignOptions}
                />
              </div>
            </div>

            <div className="space-y-3">
              {filteredTasks.map(task => {
                const effectiveDate = getTaskEffectiveDate(task);
                const isCalled = task.status === 'chiamato';
                const isOverdue = effectiveDate < today && !isTaskClosed(task.status);
                const isOwnSource = ownSourceCodes.some(code => code === task.sourceCode);
                const assignedToOther = task.assignedToUid && task.assignedToUid !== currentUid;
                const canEdit = !assignedToOther && (isOwnSource || task.assignedToUid === currentUid);
                const needsClaim = !isOwnSource && !task.assignedToUid;

                return (
                  <article
                    key={task.id}
                    className={`border rounded-lg p-4 ${
                      isCalled
                        ? 'border-emerald-200 bg-emerald-50/60'
                        : isOverdue
                        ? 'border-red-200 bg-red-50/40'
                        : 'border-slate-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-bold text-slate-800">{task.clientName}</h4>
                          <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded text-[10px] font-bold">
                            {task.categoryLabel}
                          </span>
                          {isOverdue && (
                            <span className="bg-red-100 text-red-700 px-2 py-1 rounded text-[10px] font-bold">
                              Arretrata · {format(parseISO(effectiveDate), 'dd/MM/yyyy')}
                            </span>
                          )}
                          {isCalled && (
                            <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-[10px] font-bold">
                              Chiamato
                            </span>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span><strong>Fonte:</strong> {task.sourceCode} · {task.sourceName}</span>
                          {task.policyNumber && <span><strong>Polizza:</strong> {task.policyNumber}</span>}
                          {task.policyType && <span><strong>Ramo:</strong> {task.policyType}</span>}
                          {task.vehiclePlate && <span><strong>Targa:</strong> {task.vehiclePlate}</span>}
                          {task.coverages && <span><strong>Coperture:</strong> {task.coverages}</span>}
                          {task.category === 'scadenza_rata' && task.eventDate && (
                            <span>
                              <strong>Scadenza rata:</strong> {formatDisplayDate(task.eventDate)}
                            </span>
                          )}
                          {task.category === 'scadenza_annuale' && task.eventDate && (
                            <span>
                              <strong>Scadenza annuale:</strong> {formatDisplayDate(task.eventDate)}
                            </span>
                          )}
                          {task.category === 'winback' && task.lastGrossPremium && (
                            <span>
                              <strong>Ultimo premio lordo:</strong> {formatPremium(task.lastGrossPremium)}
                            </span>
                          )}
                          {task.category === 'winback' && task.exitDate && (
                            <span>
                              <strong>Data uscita:</strong> {formatDisplayDate(task.exitDate)}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {task.phone ? (
                            <a
                              href={`tel:${task.phone.replace(/\s+/g, '')}`}
                              className="inline-flex items-center gap-2 bg-[#003781] text-white px-3 py-2 rounded-lg text-sm font-bold"
                            >
                              <Phone size={16} />
                              {task.phone}
                            </a>
                          ) : (
                            <span className="text-xs text-red-600 font-semibold">Telefono assente</span>
                          )}

                          {task.assignedToName && (
                            <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2 py-2 rounded-lg">
                              <UserCheck size={15} />
                              {task.assignedToName}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="w-full lg:w-64 shrink-0">
                        {needsClaim ? (
                          <button
                            type="button"
                            onClick={() => claimTask(task)}
                            disabled={savingTaskId === task.id}
                            className="w-full bg-[#003781] text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
                          >
                            <HandHelping size={17} />
                            Prendi in carico
                          </button>
                        ) : (
                          <select
                            value={task.status}
                            onChange={event => changeStatus(task, event.target.value as CallStatusId)}
                            disabled={!canEdit || savingTaskId === task.id}
                            className="w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781] disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            {CALL_STATUSES.map(status => (
                              <option key={status.id} value={status.id}>{status.label}</option>
                            ))}
                          </select>
                        )}

                        {assignedToOther && (
                          <p className="text-[11px] text-slate-500 mt-2">
                            Chiamata già presa in carico da {task.assignedToName}.
                          </p>
                        )}

                        {callbackTaskId === task.id && (
                          <div className="mt-2 flex gap-2">
                            <input
                              type="date"
                              min={today}
                              max={task.eventDate}
                              value={callbackDate}
                              onChange={event => setCallbackDate(event.target.value)}
                              className="min-w-0 flex-1 border border-amber-300 rounded-lg px-2 py-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => callbackDate && saveStatus(task, 'da_richiamare', callbackDate)}
                              disabled={!callbackDate || savingTaskId === task.id}
                              className="p-2.5 bg-amber-500 text-white rounded-lg disabled:opacity-40"
                              title="Conferma richiamo"
                            >
                              <Check size={17} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}

              {filteredTasks.length === 0 && (
                <div className="py-16 text-center border border-dashed border-slate-300 rounded-lg text-slate-500">
                  Nessuna chiamata per questa selezione.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function getEmployeeCalendarDate(task: CallTask, today: string): string | undefined {
  if (!isTaskCampaignWindowOpen(task, today)) return undefined;

  if (task.status === 'chiamato') {
    return task.calledDate || getTaskEffectiveDate(task);
  }

  if (isTaskClosed(task.status)) return undefined;

  const effectiveDate = getTaskEffectiveDate(task);
  if (!effectiveDate) return undefined;

  return isTaskActionable(task, today) ? today : effectiveDate;
}

function matchesCategorySelection(
  task: CallTask,
  selected: CallCategorySelection[],
): boolean {
  if (selected.length === 0) return true;
  if (task.category !== 'campagna') {
    return selected.includes(task.category);
  }

  return selected.includes('campagna') ||
    Boolean(
      task.campaignId &&
      selected.includes(`campaign:${task.campaignId}`)
    );
}

function adjustSuggestedCallback(selectedDate: string, today: string) {
  const base = selectedDate > today ? parseISO(selectedDate) : parseISO(today);
  let suggested = addDays(base, 1);
  if (suggested.getDay() === 6) suggested = addDays(suggested, 2);
  if (suggested.getDay() === 0) suggested = addDays(suggested, 1);
  return format(suggested, 'yyyy-MM-dd');
}

function getSourceKey(task: Pick<CallTask, 'sourceCode' | 'sourceName'>) {
  return `${task.sourceCode}::${task.sourceName}`;
}

function formatDisplayDate(value: string) {
  return format(parseISO(value), 'dd/MM/yyyy', { locale: it });
}

function formatPremium(value: string) {
  return value.includes('€') ? value : `${value} €`;
}
