import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  PhoneCall,
  Search,
} from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { db } from '../firebase';
import {
  Campaign,
  CallTask,
  getTaskEffectiveDate,
  isTaskActionable,
  isTaskBeforeTrackingStart,
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
type OperationalView = 'today' | 'next7' | 'active' | 'history';

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
  const [page, setPage] = useState(1);
  const today = getItalyDate();
  const nextSevenDays = format(addDays(parseISO(today), 7), 'yyyy-MM-dd');

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
            !isTaskExpired(task, today) &&
            !isTaskBeforeTrackingStart(task) &&
            effectiveDate > today &&
            effectiveDate <= nextSevenDays,
          active: !isTaskClosed(task.status) &&
            !isTaskExpired(task, today) &&
            !isTaskBeforeTrackingStart(task),
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
  ]);

  const todayCount = enabledTasks.filter(task => isTaskActionable(task, today)).length;
  const overdueCount = enabledTasks.filter(task =>
    isTaskActionable(task, today) && getTaskEffectiveDate(task) < today
  ).length;
  const nextSevenCount = enabledTasks.filter(task => {
    const effectiveDate = getTaskEffectiveDate(task);
    return !isTaskClosed(task.status) &&
      !isTaskExpired(task, today) &&
      !isTaskBeforeTrackingStart(task) &&
      effectiveDate > today &&
      effectiveDate <= nextSevenDays;
  }).length;
  const completedCount = enabledTasks.filter(task => isTaskClosed(task.status)).length;
  const pageCount = Math.max(1, Math.ceil(filteredTasks.length / PAGE_SIZE));
  const visibleTasks = filteredTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const exportCalls = () => {
    const headers = [
      'Data chiamata',
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
      <section className="grid grid-cols-2 xl:grid-cols-4 border border-slate-200 bg-white rounded-lg overflow-hidden">
        <Metric label="Da lavorare oggi" value={todayCount} icon={<PhoneCall size={18} />} />
        <Metric label="Arretrate ancora valide" value={overdueCount} icon={<Clock3 size={18} />} />
        <Metric label="Prossimi 7 giorni" value={nextSevenCount} icon={<CalendarClock size={18} />} />
        <Metric label="Completate" value={completedCount} icon={<CheckCircle2 size={18} />} />
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
                {['Data', 'Cliente', 'Categoria', 'Fonte', 'Stato', 'Assegnatario', 'Dettagli'].map(label => (
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
                    {isTaskExpired(task, today) || isTaskBeforeTrackingStart(task)
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
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-4 border-r border-b xl:border-b-0 border-slate-200 last:border-r-0">
      <div className="text-[#003781]">{icon}</div>
      <p className="text-2xl font-black text-slate-800 mt-2">{value}</p>
      <p className="text-xs font-bold text-slate-500">{label}</p>
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
  if (isTaskBeforeTrackingStart(task)) return 'Precedente all’attivazione';
  if (isTaskExpired(task, today)) return 'Finestra scaduta';
  return getStatusLabel(task.status);
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
