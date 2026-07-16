import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  PhoneCall,
  Search,
  Trophy,
} from 'lucide-react';
import { addDays, format, isValid, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { it } from 'date-fns/locale';
import { db } from '../firebase';
import {
  Campaign,
  CALL_TRACKING_START_DATE,
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
import { downloadCSV, escapeCSVCell } from '../lib/csv';
import { getItalyDate } from '../lib/utils';
import CallCategoryFilter, {
  CallCategorySelection,
  CampaignFilterOption,
} from './CallCategoryFilter';

const PAGE_SIZE = 100;
type OperationalView = 'today' | 'next7' | 'active' | 'worked' | 'history';
type WorkPeriod = 'all' | 'today' | 'week' | 'month' | 'custom';
type DateRange = {
  start: string;
  end: string;
};
type BreakdownSegment = {
  id: string;
  label: string;
  count: number;
  className: string;
};
type SourceRankingRow = {
  sourceCode: string;
  sourceName: string;
  count: number;
};

export default function AdminCallCenter() {
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CallStatusId | 'all'>('all');
  const [selectedCategories, setSelectedCategories] = useState<CallCategorySelection[]>([]);
  const [source, setSource] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [operationalView, setOperationalView] = useState<OperationalView>('today');
  const [workPeriod, setWorkPeriod] = useState<WorkPeriod>('all');
  const [workStartDate, setWorkStartDate] = useState('');
  const [workEndDate, setWorkEndDate] = useState('');
  const [page, setPage] = useState(1);
  const today = getItalyDate();
  const nextSevenDays = format(addDays(parseISO(today), 7), 'yyyy-MM-dd');
  const workPeriodRange = useMemo(() => getWorkPeriodRange(
    workPeriod,
    today,
    workStartDate,
    workEndDate,
  ), [workPeriod, today, workStartDate, workEndDate]);

  useEffect(() => {
    return onSnapshot(collection(db, 'call_tasks'), snapshot => {
      setTasks(snapshot.docs.map(item => ({
        id: item.id,
        ...item.data(),
      } as CallTask)));
      setLoading(false);
    }, error => {
      console.error('Error loading call tasks:', error);
      setLoading(false);
    });
  }, []);

  useEffect(() => onSnapshot(collection(db, 'campaigns'), snapshot => {
    setCampaigns(snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
    } as Campaign)));
  }), []);

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

  const sources = useMemo(
    () => [...new Map(
      enabledTasks.map(task => [task.sourceCode, `${task.sourceCode} · ${task.sourceName}`])
    ).entries()].sort((first, second) => first[1].localeCompare(second[1], 'it')),
    [enabledTasks]
  );

  const assignees = useMemo(
    () => [...new Set(enabledTasks.map(task => task.assignedToName).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, 'it')),
    [enabledTasks]
  );

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

  const filteredTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return enabledTasks
      .filter(task => {
        const effectiveDate = getTaskEffectiveDate(task);
        const matchesSearch = !normalizedSearch || [
          task.clientName,
          task.phone,
          task.policyNumber,
          task.vehiclePlate,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));
        const matchesOperationalView = {
          today: isTaskActionable(task, today),
          next7: !isTaskClosed(task.status) &&
            isTaskCampaignWindowOpen(task, today) &&
            !isTaskExpired(task, today) &&
            !isTaskBeforeTrackingStart(task) &&
            effectiveDate > today &&
            effectiveDate <= nextSevenDays,
          active: !isTaskClosed(task.status) &&
            isTaskCampaignWindowOpen(task, today) &&
            !isTaskExpired(task, today) &&
            !isTaskBeforeTrackingStart(task),
          worked: isTaskWorked(task) &&
            isDateInRange(getTaskWorkedDate(task), workPeriodRange.start, workPeriodRange.end),
          history: isTaskClosed(task.status) ||
            isTaskExpired(task, today) ||
            isTaskBeforeTrackingStart(task),
        }[operationalView];

        return matchesSearch && matchesOperationalView &&
          (status === 'all' || task.status === status) &&
          matchesCategorySelection(task, selectedCategories) &&
          (source === 'all' || task.sourceCode === source) &&
          (assignee === 'all' || task.assignedToName === assignee) &&
          (!startDate || effectiveDate >= startDate) &&
          (!endDate || effectiveDate <= endDate);
      })
      .sort((first, second) => {
        const dateComparison = getTaskEffectiveDate(first)
          .localeCompare(getTaskEffectiveDate(second));
        if (dateComparison !== 0) return dateComparison;
        return first.clientName.localeCompare(second.clientName, 'it');
      });
  }, [
    enabledTasks,
    search,
    status,
    selectedCategories,
    source,
    assignee,
    startDate,
    endDate,
    operationalView,
    today,
    nextSevenDays,
    workPeriodRange,
  ]);

  useEffect(() => setPage(1), [
    search,
    status,
    selectedCategories,
    source,
    assignee,
    startDate,
    endDate,
    operationalView,
    workPeriod,
    workStartDate,
    workEndDate,
  ]);

  const todayCount = enabledTasks.filter(task => isTaskActionable(task, today)).length;
  const overdueCount = enabledTasks.filter(task =>
    isTaskActionable(task, today) && getTaskEffectiveDate(task) < today
  ).length;
  const nextSevenCount = enabledTasks.filter(task => {
    const effectiveDate = getTaskEffectiveDate(task);
    return !isTaskClosed(task.status) &&
      isTaskCampaignWindowOpen(task, today) &&
      !isTaskExpired(task, today) &&
      !isTaskBeforeTrackingStart(task) &&
      effectiveDate > today &&
      effectiveDate <= nextSevenDays;
  }).length;
  const workedPeriodCount = enabledTasks.filter(task =>
    isTaskWorked(task) &&
    isDateInRange(getTaskWorkedDate(task), workPeriodRange.start, workPeriodRange.end)
  ).length;
  const possibleUntilToday = enabledTasks.filter(task => isTaskPossibleUntilToday(task, today));
  const workedUntilTodayCount = possibleUntilToday.filter(isTaskWorked).length;
  const workedUntilTodayPercent = possibleUntilToday.length > 0
    ? Math.round((workedUntilTodayCount / possibleUntilToday.length) * 100)
    : 0;
  const expiredUntilTodayCount = possibleUntilToday.filter(task =>
    !isTaskWorked(task) && isTaskExpired(task, today)
  ).length;
  const openValidUntilTodayCount = possibleUntilToday.filter(task =>
    !isTaskWorked(task) && !isTaskExpired(task, today)
  ).length;
  const possibleBreakdownSegments: BreakdownSegment[] = [
    {
      id: 'worked',
      label: 'Lavorate',
      count: workedUntilTodayCount,
      className: 'bg-emerald-500',
    },
    {
      id: 'open',
      label: 'Da chiamare valide',
      count: openValidUntilTodayCount,
      className: 'bg-blue-500',
    },
    {
      id: 'expired',
      label: 'Finestra scaduta',
      count: expiredUntilTodayCount,
      className: 'bg-amber-400',
    },
  ];
  const sourceRanking = useMemo<SourceRankingRow[]>(() => {
    const rows = new Map<string, SourceRankingRow>();

    enabledTasks.forEach(task => {
      if (
        !isTaskWorked(task) ||
        !isDateInRange(getTaskWorkedDate(task), workPeriodRange.start, workPeriodRange.end)
      ) {
        return;
      }

      const existing = rows.get(task.sourceCode);
      if (existing) {
        existing.count += 1;
        return;
      }

      rows.set(task.sourceCode, {
        sourceCode: task.sourceCode,
        sourceName: task.sourceName,
        count: 1,
      });
    });

    return [...rows.values()]
      .sort((first, second) =>
        second.count - first.count ||
        first.sourceCode.localeCompare(second.sourceCode, 'it')
      )
      .slice(0, 8);
  }, [enabledTasks, workPeriodRange]);
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const visibleTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCalls = () => {
    const headers = [
      'Data chiamata',
      'Data lavorazione',
      'Cliente',
      'Telefono',
      'Categoria',
      'Fonte',
      'Stato',
      'Assegnatario',
      'Polizza',
      'Ramo',
      'Targa',
      'Data evento',
      'Data uscita',
      'Ultimo premio lordo',
    ];
    const rows = filteredTasks.map(task => [
      formatDate(task.callbackDate || task.dueDate),
      formatDate(getTaskWorkedDate(task)),
      task.clientName,
      task.phone,
      task.categoryLabel,
      `${task.sourceCode} - ${task.sourceName}`,
      getOperationalStatus(task, today),
      task.assignedToName || '',
      task.policyNumber,
      task.policyType,
      task.vehiclePlate,
      formatDate(task.eventDate),
      formatDate(task.exitDate),
      task.lastGrossPremium,
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(value => escapeCSVCell(value)).join(';'))
      .join('\r\n');

    downloadCSV(csv, `mancinigroup_monitoraggio_chiamate_${new Date().toISOString().slice(0, 10)}.csv`);
  };

  if (loading) {
    return <div className="py-20 text-center text-slate-500">Caricamento chiamate...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-2 xl:grid-cols-5 border border-slate-200 bg-white rounded-lg overflow-hidden">
        <Metric label="Da lavorare oggi" value={todayCount} icon={<PhoneCall size={18} />} />
        <Metric label="Arretrate ancora valide" value={overdueCount} icon={<Clock3 size={18} />} />
        <Metric label="Prossimi 7 giorni" value={nextSevenCount} icon={<CalendarClock size={18} />} />
        <Metric
          label="Lavorate nel periodo"
          value={workedPeriodCount}
          detail={formatRangeLabel(workPeriodRange.start, workPeriodRange.end)}
          icon={<CheckCircle2 size={18} />}
        />
        <Metric
          label="Fatte / possibili"
          value={`${workedUntilTodayCount}/${possibleUntilToday.length}`}
          detail={`${workedUntilTodayPercent}% fino a oggi`}
          icon={<PhoneCall size={18} />}
        />
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Periodo analisi chiamate lavorate
            </p>
            <div className="flex flex-wrap gap-2">
              <ViewButton active={workPeriod === 'all'} onClick={() => setWorkPeriod('all')}>
                Tutto
              </ViewButton>
              <ViewButton active={workPeriod === 'today'} onClick={() => setWorkPeriod('today')}>
                Oggi
              </ViewButton>
              <ViewButton active={workPeriod === 'week'} onClick={() => setWorkPeriod('week')}>
                Settimana
              </ViewButton>
              <ViewButton active={workPeriod === 'month'} onClick={() => setWorkPeriod('month')}>
                Mese
              </ViewButton>
              <ViewButton active={workPeriod === 'custom'} onClick={() => setWorkPeriod('custom')}>
                Personalizzato
              </ViewButton>
            </div>
          </div>

          {workPeriod === 'custom' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 xl:w-[360px]">
              <input
                type="date"
                value={workStartDate}
                onChange={event => setWorkStartDate(event.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                title="Inizio periodo lavorazione"
              />
              <input
                type="date"
                value={workEndDate}
                onChange={event => setWorkEndDate(event.target.value)}
                className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                title="Fine periodo lavorazione"
              />
            </div>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[#003781]">
                <BarChart3 size={18} />
                <h3 className="font-bold text-slate-800">Esploso chiamate possibili</h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Dal {formatDate(CALL_TRACKING_START_DATE)} a oggi, incluse le finestre scadute.
              </p>
            </div>
            <p className="text-sm font-black text-slate-800 whitespace-nowrap">
              {possibleUntilToday.length} totali
            </p>
          </div>

          <ProgressBreakdown
            total={possibleUntilToday.length}
            segments={possibleBreakdownSegments}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-[#003781]">
            <Trophy size={18} />
            <h3 className="font-bold text-slate-800">Classifica fonti</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Chiamate lavorate nel periodo {formatRangeLabel(workPeriodRange.start, workPeriodRange.end)}.
          </p>

          <SourceRanking rows={sourceRanking} total={workedPeriodCount} />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap gap-2 mb-4">
          <ViewButton
            active={operationalView === 'today'}
            onClick={() => setOperationalView('today')}
          >
            Oggi
          </ViewButton>
          <ViewButton
            active={operationalView === 'next7'}
            onClick={() => setOperationalView('next7')}
          >
            Prossimi 7 giorni
          </ViewButton>
          <ViewButton
            active={operationalView === 'active'}
            onClick={() => setOperationalView('active')}
          >
            Tutte le attive
          </ViewButton>
          <ViewButton
            active={operationalView === 'worked'}
            onClick={() => setOperationalView('worked')}
          >
            Lavorate nel periodo
          </ViewButton>
          <ViewButton
            active={operationalView === 'history'}
            onClick={() => setOperationalView('history')}
          >
            Storico e scadute
          </ViewButton>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="relative md:col-span-2">
            <Search
              size={17}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Cerca cliente, telefono, polizza o targa"
              className="w-full border border-slate-300 rounded-lg pl-10 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
            />
          </label>

          <Select value={status} onChange={value => setStatus(value as CallStatusId | 'all')}>
            <option value="all">Tutti gli stati</option>
            {CALL_STATUSES.map(item => (
              <option key={item.id} value={item.id}>{item.label}</option>
            ))}
          </Select>

          <CallCategoryFilter
            selected={selectedCategories}
            onChange={setSelectedCategories}
            campaigns={campaignOptions}
          />

          <Select value={source} onChange={setSource}>
            <option value="all">Tutte le fonti</option>
            {sources.map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </Select>

          <Select value={assignee} onChange={setAssignee}>
            <option value="all">Tutti gli assegnatari</option>
            {assignees.map(name => <option key={name} value={name}>{name}</option>)}
          </Select>

          <input
            type="date"
            value={startDate}
            onChange={event => setStartDate(event.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
            title="Data iniziale"
          />
          <input
            type="date"
            value={endDate}
            onChange={event => setEndDate(event.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
            title="Data finale"
          />
        </div>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={exportCalls}
            disabled={filteredTasks.length === 0}
            className="flex items-center gap-2 bg-[#003781] text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
          >
            <Download size={17} />
            Esporta CSV
          </button>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {['Data', 'Lavorata', 'Cliente', 'Categoria', 'Fonte', 'Stato', 'Assegnatario', 'Dettagli'].map(label => (
                  <th key={label} className="text-left px-4 py-3 font-bold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleTasks.map(task => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 whitespace-nowrap font-semibold text-slate-700">
                    {formatDate(getTaskEffectiveDate(task))}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                    {formatDate(getTaskWorkedDate(task))}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-slate-800">{task.clientName}</p>
                    <p className="text-xs text-slate-500">{task.phone || 'Telefono assente'}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{task.categoryLabel}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-700">{task.sourceCode}</p>
                    <p className="text-xs text-slate-500 max-w-48">{task.sourceName}</p>
                  </td>
                  <td className="px-4 py-3">
                    {shouldShowExpiredBadge(task, today)
                      ? <ExpiredBadge beforeTracking={isTaskBeforeTrackingStart(task)} />
                      : <StatusBadge status={task.status} />}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {task.assignedToName || 'Non assegnata'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <div className="space-y-1">
                      <p>
                        {[task.policyNumber, task.policyType, task.vehiclePlate]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                      {task.fiscalCode && (
                        <p><strong>Codice fiscale:</strong> {task.fiscalCode}</p>
                      )}
                      {task.autoPremium && (
                        <p><strong>Premio auto:</strong> {formatPremium(task.autoPremium)}</p>
                      )}
                      {task.category === 'winback' && task.exitDate && (
                        <p><strong>Uscita:</strong> {formatDate(task.exitDate)}</p>
                      )}
                      {task.category === 'winback' && task.lastGrossPremium && (
                        <p>
                          <strong>Premio lordo:</strong> {formatPremium(task.lastGrossPremium)}
                        </p>
                      )}
                      {task.category === 'scadenza_rata' && task.eventDate && (
                        <p><strong>Scadenza rata:</strong> {formatDate(task.eventDate)}</p>
                      )}
                      {task.category === 'scadenza_annuale' && task.eventDate && (
                        <p><strong>Scadenza annuale:</strong> {formatDate(task.eventDate)}</p>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {filteredTasks.length === 0 && (
          <div className="py-16 text-center text-slate-500">Nessuna chiamata corrisponde ai filtri.</div>
        )}

        {filteredTasks.length > PAGE_SIZE && (
          <div className="p-4 border-t border-slate-200 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Pagina {page} di {pageCount}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage(value => Math.max(1, value - 1))}
                disabled={page === 1}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:opacity-40"
              >
                Indietro
              </button>
              <button
                type="button"
                onClick={() => setPage(value => Math.min(pageCount, value + 1))}
                disabled={page === pageCount}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:opacity-40"
              >
                Avanti
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  detail?: string;
}) {
  return (
    <div className="p-4 border-r border-b xl:border-b-0 border-slate-200 last:border-r-0">
      <div className="text-[#003781]">{icon}</div>
      <p className="text-2xl font-black text-slate-800 mt-2">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      {detail && <p className="text-[11px] text-slate-400 mt-1">{detail}</p>}
    </div>
  );
}

function ProgressBreakdown({
  total,
  segments,
}: {
  total: number;
  segments: BreakdownSegment[];
}) {
  const visibleSegments = segments.filter(segment => segment.count > 0);

  return (
    <div className="mt-4 space-y-4">
      <div className="h-9 bg-slate-100 rounded-lg overflow-hidden flex">
        {visibleSegments.length > 0 ? visibleSegments.map(segment => (
          <div
            key={segment.id}
            className={`${segment.className} h-full`}
            style={{ width: `${getPercent(segment.count, total)}%` }}
            title={`${segment.label}: ${segment.count} (${getPercent(segment.count, total)}%)`}
          />
        )) : (
          <div className="h-full w-full bg-slate-100" />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {segments.map(segment => (
          <div key={segment.id} className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full ${segment.className}`} />
              <span className="text-xs font-semibold text-slate-600 truncate">
                {segment.label}
              </span>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-black text-slate-800">{segment.count}</p>
              <p className="text-[11px] text-slate-400">{getPercent(segment.count, total)}%</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceRanking({
  rows,
  total,
}: {
  rows: SourceRankingRow[];
  total: number;
}) {
  const maxCount = rows[0]?.count || 0;

  if (rows.length === 0) {
    return (
      <div className="mt-4 py-6 text-center text-sm text-slate-500">
        Nessuna chiamata lavorata nel periodo.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {rows.map((row, index) => (
        <div key={row.sourceCode} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <span className="font-black text-slate-800 mr-2">{index + 1}.</span>
              <span className="font-bold text-slate-700">{row.sourceCode}</span>
              <span className="text-slate-500"> · {row.sourceName}</span>
            </div>
            <div className="font-black text-slate-800 whitespace-nowrap">
              {row.count} · {getPercent(row.count, total)}%
            </div>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#003781]"
              style={{ width: `${getPercent(row.count, maxCount)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 rounded-lg text-xs font-bold border ${
        active
          ? 'bg-[#003781] text-white border-[#003781]'
          : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={event => onChange(event.target.value)}
      className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781]"
    >
      {children}
    </select>
  );
}

function StatusBadge({ status }: { status: CallStatusId }) {
  const label = getStatusLabel(status);
  const className = {
    da_chiamare: 'bg-blue-50 text-blue-700',
    chiamato: 'bg-emerald-50 text-emerald-700',
    da_richiamare: 'bg-amber-50 text-amber-700',
    non_raggiungibile: 'bg-slate-100 text-slate-700',
    cambio_rottamazione_macchina: 'bg-violet-50 text-violet-700',
    non_gradito: 'bg-orange-50 text-orange-700',
    ripreso: 'bg-teal-50 text-teal-700',
    cliente_perso: 'bg-red-50 text-red-700',
  }[status];

  return <span className={`inline-flex px-2 py-1 rounded text-xs font-bold ${className}`}>{label}</span>;
}

function ExpiredBadge({ beforeTracking }: { beforeTracking: boolean }) {
  return (
    <span className="inline-flex px-2 py-1 rounded text-xs font-bold bg-slate-200 text-slate-600">
      {beforeTracking ? 'Precedente all’attivazione' : 'Finestra scaduta'}
    </span>
  );
}

function getStatusLabel(status: CallStatusId) {
  return CALL_STATUSES.find(item => item.id === status)?.label || status;
}

function getOperationalStatus(task: CallTask, today: string) {
  if (shouldShowExpiredBadge(task, today)) {
    return isTaskBeforeTrackingStart(task)
      ? 'Precedente all’attivazione'
      : 'Finestra scaduta';
  }
  return getStatusLabel(task.status);
}

function getWorkPeriodRange(
  period: WorkPeriod,
  today: string,
  customStart: string,
  customEnd: string,
): DateRange {
  const todayDate = parseISO(today);

  if (period === 'all') {
    return {
      start: CALL_TRACKING_START_DATE,
      end: today,
    };
  }

  if (period === 'week') {
    return {
      start: format(startOfWeek(todayDate, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      end: today,
    };
  }

  if (period === 'month') {
    return {
      start: format(startOfMonth(todayDate), 'yyyy-MM-dd'),
      end: today,
    };
  }

  if (period === 'custom') {
    return {
      start: customStart || today,
      end: customEnd || today,
    };
  }

  return { start: today, end: today };
}

function isTaskWorked(task: CallTask): boolean {
  return task.status !== 'da_chiamare';
}

function getTaskWorkedDate(task: CallTask): string {
  if (!isTaskWorked(task)) return '';
  if (task.calledDate) return task.calledDate;
  return getFirestoreDate(task.updatedAt) || getTaskEffectiveDate(task);
}

function getFirestoreDate(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date = value.toDate();
    return isValid(date) ? format(date, 'yyyy-MM-dd') : '';
  }

  if (typeof value === 'string') {
    return value.slice(0, 10);
  }

  return '';
}

function isDateInRange(date: string, start: string, end: string): boolean {
  if (!date) return false;
  const normalizedStart = start || date;
  const normalizedEnd = end || date;
  return date >= normalizedStart && date <= normalizedEnd;
}

function isTaskPossibleUntilToday(task: CallTask, today: string): boolean {
  if (!isTaskCampaignWindowOpen(task, today)) return false;
  if (!task.dueDate || task.dueDate > today) return false;
  if (task.dueDate < CALL_TRACKING_START_DATE) return false;
  return true;
}

function shouldShowExpiredBadge(task: CallTask, today: string): boolean {
  return !isTaskWorked(task) &&
    (isTaskExpired(task, today) || isTaskBeforeTrackingStart(task));
}

function formatRangeLabel(start: string, end: string): string {
  if (!start && !end) return '';
  if (start === end) return formatDate(start);
  return `${formatDate(start)} - ${formatDate(end)}`;
}

function getPercent(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
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

function formatDate(value: string) {
  if (!value) return '';
  return format(parseISO(value), 'dd/MM/yyyy', { locale: it });
}

function formatPremium(value: string) {
  return value.includes('€') ? value : `${value} €`;
}
