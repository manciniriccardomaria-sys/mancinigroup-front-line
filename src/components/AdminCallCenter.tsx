import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  Activity,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  PhoneCall,
  Search,
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
const WINBACK_PERFORMANCE_ID = '__winback__';
type OperationalView =
  | 'today'
  | 'overdue'
  | 'next7'
  | 'active'
  | 'worked'
  | 'workedPossible'
  | 'possible'
  | 'history';
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
type SourceActivityRow = {
  sourceCode: string;
  sourceName: string;
  count: number;
};
type CampaignSourcePerformance = {
  sourceCode: string;
  sourceName: string;
  possible: number;
  worked: number;
  expired: number;
  open: number;
};
type CampaignPerformance = {
  campaign: Campaign;
  possible: number;
  worked: number;
  expired: number;
  open: number;
  sources: CampaignSourcePerformance[];
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
  const [expandedCampaignIds, setExpandedCampaignIds] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const callsListRef = useRef<HTMLElement | null>(null);
  const today = getItalyDate();
  const nextSevenDays = format(addDays(parseISO(today), 7), 'yyyy-MM-dd');
  const workPeriodRange = useMemo(() => getWorkPeriodRange(
    workPeriod,
    today,
    workStartDate,
    workEndDate,
  ), [workPeriod, today, workStartDate, workEndDate]);
  const taskWindowEnd = useMemo(() => {
    const requestedEnds = [
      nextSevenDays,
      endDate,
      workPeriodRange.end,
    ].filter(Boolean);
    return requestedEnds.reduce((latest, value) =>
      value > latest ? value : latest,
      nextSevenDays,
    );
  }, [endDate, nextSevenDays, workPeriodRange.end]);

  useEffect(() => {
    const tasksQuery = query(
      collection(db, 'call_tasks'),
      where('dueDate', '>=', CALL_TRACKING_START_DATE),
      where('dueDate', '<=', taskWindowEnd),
    );

    return onSnapshot(tasksQuery, snapshot => {
      setTasks(snapshot.docs.map(item => ({
        id: item.id,
        ...item.data(),
      } as CallTask)));
      setLoading(false);
    }, error => {
      console.error('Error loading call tasks:', error);
      setLoading(false);
    });
  }, [taskWindowEnd]);

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
  const activeCampaignsById = useMemo(
    () => new Map(activeCampaigns.map(campaign => [campaign.id, campaign])),
    [activeCampaigns]
  );

  const enabledTasks = useMemo(
    () => tasks.filter(task => {
      if (!isCallCategoryEnabled(task.category)) return false;
      if (task.category !== 'campagna') return true;
      if (!task.campaignId) return false;

      const campaign = activeCampaignsById.get(task.campaignId);
      return Boolean(
        campaign &&
        task.dueDate >= getCampaignOperationalStartDate(campaign)
      );
    }),
    [tasks, activeCampaignsById]
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
          overdue: isTaskActionable(task, today) && effectiveDate < today,
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
          workedPossible: isTaskPossibleUntilToday(task, today) && isTaskWorked(task),
          possible: isTaskPossibleUntilToday(task, today),
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
      label: 'Effettuate',
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
  const campaignPerformances = useMemo<CampaignPerformance[]>(() => {
    const configuredCampaigns = activeCampaigns.map(campaign =>
      buildCampaignPerformance(
        campaign,
        enabledTasks.filter(task =>
          task.category === 'campagna' && task.campaignId === campaign.id
        ),
        today,
      )
    );
    const winbackCampaign: Campaign = {
      id: WINBACK_PERFORMANCE_ID,
      name: 'Winback',
      description: 'Richiamo clienti usciti in prossimità dell’anniversario.',
      active: true,
    };
    const winbackPerformance = buildCampaignPerformance(
      winbackCampaign,
      enabledTasks.filter(task => task.category === 'winback'),
      today,
    );

    return [...configuredCampaigns, winbackPerformance].sort((first, second) =>
      first.campaign.id === WINBACK_PERFORMANCE_ID
        ? 1
        : second.campaign.id === WINBACK_PERFORMANCE_ID
          ? -1
          : first.campaign.name.localeCompare(second.campaign.name, 'it')
    );
  }, [activeCampaigns, enabledTasks, today]);
  const sourceActivity = useMemo<SourceActivityRow[]>(() => {
    const rows = new Map<string, SourceActivityRow>();

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

  const showMetricTasks = (view: OperationalView) => {
    setSearch('');
    setStatus('all');
    setSelectedCategories([]);
    setSource('all');
    setAssignee('all');
    setStartDate('');
    setEndDate('');
    setOperationalView(view);
    setPage(1);
    window.setTimeout(() => {
      callsListRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

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
        <Metric
          label="Da lavorare oggi"
          value={todayCount}
          icon={<PhoneCall size={18} />}
          active={operationalView === 'today'}
          onClick={() => showMetricTasks('today')}
        />
        <Metric
          label="Arretrate ancora valide"
          value={overdueCount}
          icon={<Clock3 size={18} />}
          active={operationalView === 'overdue'}
          onClick={() => showMetricTasks('overdue')}
        />
        <Metric
          label="Prossimi 7 giorni"
          value={nextSevenCount}
          icon={<CalendarClock size={18} />}
          active={operationalView === 'next7'}
          onClick={() => showMetricTasks('next7')}
        />
        <Metric
          label="Effettuate nel periodo"
          value={workedPeriodCount}
          detail={formatRangeLabel(workPeriodRange.start, workPeriodRange.end)}
          icon={<CheckCircle2 size={18} />}
          active={operationalView === 'worked'}
          onClick={() => showMetricTasks('worked')}
        />
        <RatioMetric
          worked={workedUntilTodayCount}
          possible={possibleUntilToday.length}
          detail={`${workedUntilTodayPercent}% fino a oggi`}
          icon={<PhoneCall size={18} />}
          workedActive={operationalView === 'workedPossible'}
          possibleActive={operationalView === 'possible'}
          onWorkedClick={() => showMetricTasks('workedPossible')}
          onPossibleClick={() => showMetricTasks('possible')}
        />
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

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide mb-2">
              Periodo analisi chiamate effettuate
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

            {workPeriod === 'custom' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
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

          <ProgressBreakdown
            total={possibleUntilToday.length}
            segments={possibleBreakdownSegments}
          />
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-2 text-[#003781]">
            <Activity size={18} />
            <h3 className="font-bold text-slate-800">Attività fonti</h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Chiamate effettuate nel periodo {formatRangeLabel(workPeriodRange.start, workPeriodRange.end)}.
          </p>

          <SourceActivity rows={sourceActivity} total={workedPeriodCount} />
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-[#003781]">
          <BarChart3 size={18} />
          <h3 className="font-bold text-slate-800">Performance campagne attive</h3>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {campaignPerformances.length}{' '}
          {campaignPerformances.length === 1 ? 'campagna attiva' : 'campagne attive'},
          {' '}Winback incluso. Seleziona una campagna per aprire i dettagli.
        </p>
        <p className="text-xs text-slate-500 mt-2 max-w-4xl">
          Effettuate include ogni chiamata con un esito registrato, anche da richiamare,
          non raggiungibile, non gradito e gli altri esiti. Possibili include le chiamate
          entrate nella finestra operativa dal {formatDate(CALL_TRACKING_START_DATE)} a oggi.
        </p>

        <div className="mt-4 space-y-3">
          {campaignPerformances.map(performance => {
            const expanded = expandedCampaignIds.includes(performance.campaign.id);

            return (
              <CampaignPerformanceCard
                key={performance.campaign.id}
                performance={performance}
                expanded={expanded}
                onToggle={() => setExpandedCampaignIds(previous =>
                  expanded
                    ? previous.filter(id => id !== performance.campaign.id)
                    : [...previous, performance.campaign.id]
                )}
              />
            );
          })}
        </div>
      </section>

      <section
        ref={callsListRef}
        className="bg-white border border-slate-200 rounded-lg p-4 scroll-mt-4"
      >
        <div className="mb-4">
          <h3 className="font-bold text-slate-800">Elenco chiamate</h3>
          <p className="text-xs text-slate-500 mt-1">
            {getOperationalViewLabel(operationalView)} · {filteredTasks.length} risultati
          </p>
        </div>

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
            Effettuate nel periodo
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
                {['Data', 'Effettuata', 'Cliente', 'Categoria', 'Fonte', 'Stato', 'Assegnatario', 'Dettagli'].map(label => (
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
                        {[
                          task.policyNumber,
                          task.policyType,
                          task.vehiclePlate,
                          task.autoPremium ? `Premio auto ${formatPremium(task.autoPremium)}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </p>
                      {task.fiscalCode && (
                        <p><strong>Codice fiscale:</strong> {task.fiscalCode}</p>
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
  active,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  detail?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`p-4 border-r border-b xl:border-b-0 border-slate-200 last:border-r-0 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#003781] ${
        active ? 'bg-blue-50' : 'bg-white hover:bg-slate-50'
      }`}
    >
      <div className="text-[#003781]">{icon}</div>
      <p className="text-2xl font-black text-slate-800 mt-2">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
      {detail && <p className="text-[11px] text-slate-400 mt-1">{detail}</p>}
    </button>
  );
}

function RatioMetric({
  worked,
  possible,
  icon,
  detail,
  workedActive,
  possibleActive,
  onWorkedClick,
  onPossibleClick,
}: {
  worked: number;
  possible: number;
  icon: React.ReactNode;
  detail: string;
  workedActive: boolean;
  possibleActive: boolean;
  onWorkedClick: () => void;
  onPossibleClick: () => void;
}) {
  return (
    <div className="p-4 border-r border-b xl:border-b-0 border-slate-200 last:border-r-0 bg-white">
      <div className="text-[#003781]">{icon}</div>
      <div className="flex items-baseline gap-1 mt-2 text-2xl font-black">
        <button
          type="button"
          onClick={onWorkedClick}
          aria-pressed={workedActive}
          className={`rounded px-1 -ml-1 focus:outline-none focus:ring-2 focus:ring-[#003781] ${
            workedActive ? 'bg-[#003781] text-white' : 'text-slate-800 hover:bg-blue-50'
          }`}
          title="Mostra le chiamate effettuate fino a oggi"
        >
          {worked}
        </button>
        <span className="text-slate-400">/</span>
        <button
          type="button"
          onClick={onPossibleClick}
          aria-pressed={possibleActive}
          className={`rounded px-1 focus:outline-none focus:ring-2 focus:ring-[#003781] ${
            possibleActive ? 'bg-[#003781] text-white' : 'text-slate-800 hover:bg-blue-50'
          }`}
          title="Mostra tutte le chiamate possibili fino a oggi"
        >
          {possible}
        </button>
      </div>
      <p className="text-xs font-bold text-slate-500">Effettuate / possibili</p>
      <p className="text-[11px] text-slate-400 mt-1">{detail}</p>
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
    <div className="mt-4 space-y-3">
      <div className="h-8 bg-slate-100 rounded-lg overflow-hidden flex">
        {visibleSegments.length > 0 ? visibleSegments.map(segment => (
          <div
            key={segment.id}
            className={`${segment.className} h-full min-w-0 flex items-center justify-center px-1`}
            style={{ width: `${getPercent(segment.count, total)}%` }}
            title={`${segment.label}: ${segment.count} (${getPercent(segment.count, total)}%)`}
          >
            <span className={`text-xs font-black truncate ${
              segment.id === 'expired' ? 'text-slate-800' : 'text-white'
            }`}>
              {segment.count}
            </span>
          </div>
        )) : (
          <div className="h-full w-full bg-slate-100" />
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {segments.map(segment => (
          <div key={segment.id} className="flex items-center justify-between gap-2 min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`w-2.5 h-2.5 rounded-full ${segment.className}`} />
              <span className="text-xs font-semibold text-slate-600 truncate">
                {segment.label}
              </span>
            </div>
            <span className="text-[11px] font-bold text-slate-400 shrink-0">
              {getPercent(segment.count, total)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourceActivity({
  rows,
  total,
}: {
  rows: SourceActivityRow[];
  total: number;
}) {
  const maxCount = rows[0]?.count || 0;

  if (rows.length === 0) {
    return (
      <div className="mt-4 py-6 text-center text-sm text-slate-500">
        Nessuna chiamata effettuata nel periodo.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      {rows.map(row => (
        <div key={row.sourceCode} className="space-y-1.5">
          <div className="flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
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

function CampaignPerformanceCard({
  performance,
  expanded,
  onToggle,
}: {
  performance: CampaignPerformance;
  expanded: boolean;
  onToggle: () => void;
}) {
  const completionPercent = getPercent(performance.worked, performance.possible);

  return (
    <article className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full p-4 bg-slate-50 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 text-left hover:bg-slate-100 transition-colors ${
          expanded ? 'border-b border-slate-200' : ''
        }`}
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-black text-slate-800">{performance.campaign.name}</h4>
            <span className="inline-flex px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase tracking-wide">
              Attiva
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {getCampaignKindLabel(performance.campaign)}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="sm:text-right">
            <p className="text-2xl font-black text-[#003781]">{completionPercent}%</p>
            <p className="text-[11px] font-bold text-slate-500">performance complessiva</p>
          </div>
          <ChevronDown
            size={20}
            className={`text-[#003781] transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div>
          <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CampaignMetric
              label="Chiamate effettuate / possibili"
              value={`${performance.worked}/${performance.possible}`}
              detail={`${completionPercent}% completate`}
              tone="success"
            />
            <CampaignMetric
              label="Perse per limite temporale"
              value={performance.expired}
              detail={`${getPercent(performance.expired, performance.possible)}% delle possibili`}
              tone="warning"
            />
            <CampaignMetric
              label="Ancora lavorabili"
              value={performance.open}
              detail={`${getPercent(performance.open, performance.possible)}% delle possibili`}
              tone="info"
            />
          </div>

          <div className="border-t border-slate-200">
            <div className="px-4 pt-4">
              <h5 className="text-sm font-black text-slate-800">Attività fonti</h5>
              <p className="text-xs text-slate-500 mt-1">
                Dettaglio delle fonti sulle chiamate possibili della campagna.
              </p>
            </div>

            {performance.sources.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                Nessuna chiamata è ancora entrata nella finestra operativa.
              </div>
            ) : (
              <div className="overflow-x-auto mt-3">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-bold">Fonte</th>
                      <th className="px-4 py-2.5 text-right font-bold">Effettuate / possibili</th>
                      <th className="px-4 py-2.5 text-right font-bold">Completamento</th>
                      <th className="px-4 py-2.5 text-right font-bold">Perse per limite</th>
                      <th className="px-4 py-2.5 text-right font-bold">Ancora lavorabili</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {performance.sources.map(row => (
                      <tr key={`${row.sourceCode}|${row.sourceName}`}>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-800">{row.sourceCode}</p>
                          <p className="text-xs text-slate-500">{row.sourceName}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-black text-slate-800">
                          {row.worked}/{row.possible}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-emerald-700">
                          {getPercent(row.worked, row.possible)}%
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-amber-700">
                          {row.expired}
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-blue-700">
                          {row.open}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function CampaignMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  tone: 'success' | 'warning' | 'info';
}) {
  const className = {
    success: 'bg-emerald-50 border-emerald-100 text-emerald-700',
    warning: 'bg-amber-50 border-amber-100 text-amber-700',
    info: 'bg-blue-50 border-blue-100 text-blue-700',
  }[tone];

  return (
    <div className={`border rounded-lg p-3 ${className}`}>
      <p className="text-2xl font-black">{value}</p>
      <p className="text-xs font-bold mt-1">{label}</p>
      <p className="text-[11px] opacity-75 mt-1">{detail}</p>
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

function getCampaignOperationalStartDate(campaign: Campaign): string {
  const configuredStart = campaign.startDate?.match(/^\d{4}-\d{2}-\d{2}$/)
    ? campaign.startDate
    : '';
  if (configuredStart) {
    return configuredStart > CALL_TRACKING_START_DATE
      ? configuredStart
      : CALL_TRACKING_START_DATE;
  }

  const createdDate = getFirestoreDate(campaign.createdAt);
  return createdDate > CALL_TRACKING_START_DATE
    ? createdDate
    : CALL_TRACKING_START_DATE;
}

function isDateInRange(date: string, start: string, end: string): boolean {
  if (!date) return false;
  const normalizedStart = start || date;
  const normalizedEnd = end || date;
  return date >= normalizedStart && date <= normalizedEnd;
}

function isTaskPossibleUntilToday(
  task: CallTask,
  today: string,
  trackingStartDate = CALL_TRACKING_START_DATE,
): boolean {
  if (!isTaskCampaignWindowOpen(task, today)) return false;
  if (!task.dueDate || task.dueDate > today) return false;
  if (task.dueDate < trackingStartDate) return false;
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

function buildCampaignPerformance(
  campaign: Campaign,
  tasks: CallTask[],
  today: string,
): CampaignPerformance {
  const trackingStartDate = getCampaignOperationalStartDate(campaign);
  const possibleTasks = tasks.filter(task =>
    isTaskPossibleUntilToday(task, today, trackingStartDate)
  );
  const sourceRows = new Map<string, CampaignSourcePerformance>();

  possibleTasks.forEach(task => {
    const sourceKey = `${task.sourceCode}|${task.sourceName}`;
    const existing = sourceRows.get(sourceKey) || {
      sourceCode: task.sourceCode,
      sourceName: task.sourceName,
      possible: 0,
      worked: 0,
      expired: 0,
      open: 0,
    };

    existing.possible += 1;
    if (isTaskWorked(task)) {
      existing.worked += 1;
    } else if (isTaskExpired(task, today)) {
      existing.expired += 1;
    } else {
      existing.open += 1;
    }
    sourceRows.set(sourceKey, existing);
  });

  const worked = possibleTasks.filter(isTaskWorked).length;
  const expired = possibleTasks.filter(task =>
    !isTaskWorked(task) && isTaskExpired(task, today)
  ).length;

  return {
    campaign,
    possible: possibleTasks.length,
    worked,
    expired,
    open: possibleTasks.length - worked - expired,
    sources: [...sourceRows.values()].sort((first, second) =>
      first.sourceCode.localeCompare(second.sourceCode, 'it') ||
      first.sourceName.localeCompare(second.sourceName, 'it')
    ),
  };
}

function getOperationalViewLabel(view: OperationalView): string {
  return {
    today: 'Da lavorare oggi',
    overdue: 'Arretrate ancora valide',
    next7: 'Prossimi 7 giorni',
    active: 'Tutte le chiamate attive',
    worked: 'Effettuate nel periodo',
    workedPossible: 'Effettuate fino a oggi',
    possible: 'Tutte le chiamate possibili fino a oggi',
    history: 'Storico e chiamate scadute',
  }[view];
}

function getCampaignKindLabel(campaign: Campaign): string {
  if (campaign.id === WINBACK_PERFORMANCE_ID) {
    return 'Winback · anniversario dell’uscita cliente';
  }

  if (campaign.campaignKind === 'annualExpirations') {
    const timing = typeof campaign.daysBeforeExpiration === 'number'
      ? ` · ${campaign.daysBeforeExpiration} giorni prima della scadenza`
      : '';
    return `Scadenze annuali${timing} · dal ${formatDate(getCampaignOperationalStartDate(campaign))}`;
  }

  if (campaign.campaignKind === 'newClients' || !campaign.campaignKind) {
    const timing = typeof campaign.monthsAfterStart === 'number'
      ? ` · ${campaign.monthsAfterStart} mesi dall’inizio rapporto`
      : '';
    return `Nuovi clienti${timing} · dal ${formatDate(getCampaignOperationalStartDate(campaign))}`;
  }

  return campaign.description || 'Campagna';
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
