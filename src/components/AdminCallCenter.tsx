import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  CheckCircle2,
  Download,
  PhoneCall,
  Search,
  UserCheck,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale';
import { db } from '../firebase';
import {
  CallTask,
  getTaskEffectiveDate,
  isTaskClosed,
} from '../callCenter';
import { CALL_STATUSES, CallStatusId } from '../callWorkflowConfig';
import { downloadCSV, escapeCSVCell } from '../lib/csv';

const PAGE_SIZE = 100;

export default function AdminCallCenter() {
  const [tasks, setTasks] = useState<CallTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CallStatusId | 'all'>('all');
  const [category, setCategory] = useState('all');
  const [source, setSource] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [page, setPage] = useState(1);

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

  const sources = useMemo(
    () => [...new Map(
      tasks.map(task => [task.sourceCode, `${task.sourceCode} · ${task.sourceName}`])
    ).entries()].sort((first, second) => first[1].localeCompare(second[1], 'it')),
    [tasks]
  );

  const assignees = useMemo(
    () => [...new Set(tasks.map(task => task.assignedToName).filter(Boolean))]
      .sort((first, second) => first.localeCompare(second, 'it')),
    [tasks]
  );

  const filteredTasks = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return tasks
      .filter(task => {
        const effectiveDate = getTaskEffectiveDate(task);
        const matchesSearch = !normalizedSearch || [
          task.clientName,
          task.phone,
          task.policyNumber,
          task.vehiclePlate,
        ].some(value => value?.toLowerCase().includes(normalizedSearch));

        return matchesSearch &&
          (status === 'all' || task.status === status) &&
          (category === 'all' || task.category === category) &&
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
  }, [tasks, search, status, category, source, assignee, startDate, endDate]);

  useEffect(() => setPage(1), [
    search,
    status,
    category,
    source,
    assignee,
    startDate,
    endDate,
  ]);

  const openCount = filteredTasks.filter(task => !isTaskClosed(task.status)).length;
  const completedCount = filteredTasks.filter(task => isTaskClosed(task.status)).length;
  const assignedCount = filteredTasks.filter(task => task.assignedToUid).length;
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
    ];
    const rows = filteredTasks.map(task => [
      formatDate(task.callbackDate || task.dueDate),
      task.clientName,
      task.phone,
      task.categoryLabel,
      `${task.sourceCode} - ${task.sourceName}`,
      getStatusLabel(task.status),
      task.assignedToName || '',
      task.policyNumber,
      task.policyType,
      task.vehiclePlate,
      formatDate(task.eventDate),
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
        <Metric label="Risultati" value={filteredTasks.length} icon={<PhoneCall size={18} />} />
        <Metric label="Da lavorare" value={openCount} icon={<PhoneCall size={18} />} />
        <Metric label="Completate" value={completedCount} icon={<CheckCircle2 size={18} />} />
        <Metric label="Prese in carico" value={assignedCount} icon={<UserCheck size={18} />} />
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-4">
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

          <Select value={category} onChange={setCategory}>
            <option value="all">Tutte le categorie</option>
            <option value="campagna">Campagne</option>
            <option value="scadenza_rata">Scadenze rata</option>
            <option value="scadenza_annuale">Scadenze annuali</option>
            <option value="winback">Winback</option>
          </Select>

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
                    <StatusBadge status={task.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {task.assignedToName || 'Non assegnata'}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {[task.policyNumber, task.policyType, task.vehiclePlate]
                      .filter(Boolean)
                      .join(' · ') || '—'}
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

function getStatusLabel(status: CallStatusId) {
  return CALL_STATUSES.find(item => item.id === status)?.label || status;
}

function formatDate(value: string) {
  if (!value) return '';
  return format(parseISO(value), 'dd/MM/yyyy', { locale: it });
}
