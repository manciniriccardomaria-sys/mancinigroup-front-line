import React, { useEffect, useMemo, useState } from 'react';
import {
  endOfWeek,
  format,
  isValid,
  isWithinInterval,
  parseISO,
  startOfWeek,
} from 'date-fns';
import { it } from 'date-fns/locale';
import {
  AlertTriangle,
  CalendarDays,
  Gift,
  Loader2,
  Phone,
  Star,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  collection,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { getAuthorizedEmployee } from '../constants';
import {
  CUSTOMER_CLUSTER_ALLOWED_EMPLOYEE_EMAIL,
  CustomerClusterBucket,
  CustomerClusterRecord,
} from '../customerClusters';
import { getItalyDate } from '../lib/utils';

type BucketSummary = {
  bucket: CustomerClusterBucket;
  label: string;
  stars: number;
  count: number;
  annualPremium: number;
  agencyCommissions: number;
  color: string;
  textColor: string;
  note: string;
};

const BUCKETS: Array<Omit<BucketSummary, 'count' | 'annualPremium' | 'agencyCommissions'>> = [
  {
    bucket: '1',
    label: '1 polizza',
    stars: 1,
    color: '#BDF768',
    textColor: '#122018',
    note: 'Cliente da sviluppare',
  },
  {
    bucket: '2',
    label: '2 polizze',
    stars: 2,
    color: '#8DE8E1',
    textColor: '#0D2A2A',
    note: 'Cliente da sviluppare',
  },
  {
    bucket: '3',
    label: '3 polizze',
    stars: 3,
    color: '#28D0B8',
    textColor: '#062B28',
    note: '',
  },
  {
    bucket: '4',
    label: '4 polizze',
    stars: 4,
    color: '#8D8CF4',
    textColor: '#10143E',
    note: '',
  },
  {
    bucket: '5',
    label: '5 polizze',
    stars: 5,
    color: '#F8C36A',
    textColor: '#301C05',
    note: 'Cliente da curare',
  },
  {
    bucket: '>5',
    label: 'Più di 5 polizze',
    stars: 6,
    color: '#F59FB5',
    textColor: '#3A0B18',
    note: 'Cliente da curare',
  },
];

export default function EmployeeCustomerClusters() {
  const [records, setRecords] = useState<CustomerClusterRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const userEmail = auth.currentUser?.email?.trim().toLowerCase() || '';
  const employee = getAuthorizedEmployee(userEmail);
  const sourceCodes = employee?.sourceCodes || [];
  const canView = userEmail === CUSTOMER_CLUSTER_ALLOWED_EMPLOYEE_EMAIL;

  useEffect(() => {
    if (!canView || sourceCodes.length === 0) {
      setRecords([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    const clustersQuery = sourceCodes.length === 1
      ? query(
          collection(db, 'customer_clusters'),
          where('sourceCode', '==', sourceCodes[0]),
        )
      : query(
          collection(db, 'customer_clusters'),
          where('sourceCode', 'in', [...sourceCodes]),
        );

    return onSnapshot(
      clustersQuery,
      snapshot => {
        setRecords(snapshot.docs.map(item => ({
          id: item.id,
          ...item.data(),
        } as CustomerClusterRecord)));
        setError('');
        setLoading(false);
      },
      snapshotError => {
        console.error('Error loading customer clusters:', snapshotError);
        setError('Non è stato possibile caricare i cluster clienti.');
        setLoading(false);
      },
    );
  }, [canView, sourceCodes.join('|')]);

  const today = useMemo(() => parseISO(getItalyDate()), []);
  const weekInterval = useMemo(() => ({
    start: startOfWeek(today, { weekStartsOn: 1 }),
    end: endOfWeek(today, { weekStartsOn: 1 }),
  }), [today]);

  const summaries = useMemo<BucketSummary[]>(() => BUCKETS.map(bucket => {
    const bucketRecords = records.filter(record => record.policyBucket === bucket.bucket);

    return {
      ...bucket,
      count: bucketRecords.length,
      annualPremium: bucketRecords.reduce(
        (total, record) => total + (record.annualPremium || 0),
        0,
      ),
      agencyCommissions: bucketRecords.reduce(
        (total, record) => total + (record.agencyCommissions || 0),
        0,
      ),
    };
  }), [records]);

  const weeklyQuietanzaRecords = useMemo(() => records
    .filter(record => {
      const date = parseSafeDate(record.quietanzaDate);
      return date ? isWithinInterval(date, weekInterval) : false;
    })
    .sort((first, second) => {
      const dateComparison = first.quietanzaDate.localeCompare(second.quietanzaDate);
      return dateComparison || first.clientName.localeCompare(second.clientName, 'it');
    }), [records, weekInterval]);

  const totals = useMemo(() => ({
    clients: records.length,
    annualPremium: records.reduce((total, record) => total + (record.annualPremium || 0), 0),
    agencyCommissions: records.reduce(
      (total, record) => total + (record.agencyCommissions || 0),
      0,
    ),
    weeklyQuietanza: weeklyQuietanzaRecords.length,
  }), [records, weeklyQuietanzaRecords]);

  const maxBucketCount = Math.max(1, ...summaries.map(summary => summary.count));
  const sourceLabel = sourceCodes
    .map(code => {
      const sourceName = records.find(record => record.sourceCode === code)?.sourceName || `Fonte ${code}`;
      return `${code} ${sourceName}`;
    })
    .join(' · ');

  if (!canView) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-8 text-center">
        <AlertTriangle className="mx-auto text-amber-600" size={32} />
        <h2 className="mt-3 font-bold text-slate-800">Cluster clienti non abilitato</h2>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-8 flex items-center justify-center gap-2 text-slate-600">
        <Loader2 className="animate-spin text-[#003781]" size={22} />
        Caricamento cluster clienti...
      </section>
    );
  }

  return (
    <section className="space-y-4">
      {error && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Cluster clienti</h2>
          <p className="text-sm text-slate-500 mt-1">{sourceLabel || 'Fonti Rossella'}</p>
        </div>
        <div className="text-xs font-bold text-slate-500">
          Settimana {format(weekInterval.start, 'dd MMM', { locale: it })} - {format(weekInterval.end, 'dd MMM yyyy', { locale: it })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-200 rounded-lg overflow-hidden">
        <MetricCard icon={Users} value={formatInteger(totals.clients)} label="Clienti in portafoglio" />
        <MetricCard icon={TrendingUp} value={formatMoney(totals.agencyCommissions)} label="Provvigioni generate" />
        <MetricCard icon={Star} value={formatMoney(totals.annualPremium)} label="Premio annuo clienti" />
        <MetricCard icon={CalendarDays} value={formatInteger(totals.weeklyQuietanza)} label="Quietanze in settimana" />
      </div>

      {records.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg py-12 text-center text-slate-500">
          Nessun cliente clusterizzato. Carica il file Estrazione dalla parte admin.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)] gap-4 items-start">
            <div className="bg-[#E7E6D8] border border-slate-300 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-300">
                <h3 className="font-black text-slate-900">Clienti per numero di polizze</h3>
              </div>
              <div className="p-4 space-y-0">
                {summaries.map((summary, index) => {
                  const width = Math.max(
                    summary.count === 0 ? 36 : 46,
                    Math.round((summary.count / maxBucketCount) * 100),
                  );

                  return (
                    <div
                      key={summary.bucket}
                      className="min-h-[92px] border border-slate-500/60 shadow-sm flex items-end justify-between gap-3 px-4 py-3 mx-auto"
                      style={{
                        width: `${width}%`,
                        backgroundColor: summary.color,
                        color: summary.textColor,
                        marginTop: index === 0 ? 0 : -1,
                      }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 mb-2">
                          <StarRating stars={summary.stars} compact />
                        </div>
                        <p className="text-sm font-black leading-tight">{summary.label}</p>
                        <p className="text-xs font-bold opacity-80 mt-1">
                          Provvigioni {formatMoney(summary.agencyCommissions)}
                        </p>
                      </div>
                      <div className="text-5xl md:text-6xl font-black tracking-normal leading-none">
                        {summary.count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                <Gift size={18} className="text-[#003781]" />
                <h3 className="font-bold text-slate-800">Azioni suggerite</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {summaries
                  .filter(summary => summary.note)
                  .map(summary => (
                    <div key={summary.bucket} className="p-4">
                      <div className="flex items-center justify-between gap-3">
                        <StarRating stars={summary.stars} />
                        <span className="text-sm font-black text-slate-900">
                          {summary.count} clienti
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-800">
                        {summary.note}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Premio annuo {formatMoney(summary.annualPremium)} · Provvigioni {formatMoney(summary.agencyCommissions)}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="font-black text-slate-900">Scadenze quietanza della settimana</h3>
                <p className="text-xs text-slate-500">
                  Clienti della fonte con quietanza tra {formatDate(weekInterval.start)} e {formatDate(weekInterval.end)}.
                </p>
              </div>
              <span className="text-sm font-black text-[#003781]">
                {weeklyQuietanzaRecords.length}
              </span>
            </div>

            {weeklyQuietanzaRecords.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                Nessuna scadenza quietanza in questa settimana.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-black">Scadenza</th>
                      <th className="px-4 py-3 font-black">Cliente</th>
                      <th className="px-4 py-3 font-black">Stelle</th>
                      <th className="px-4 py-3 font-black">Fonte</th>
                      <th className="px-4 py-3 font-black">Nascita</th>
                      <th className="px-4 py-3 font-black">Contatti</th>
                      <th className="px-4 py-3 font-black">Anzianità</th>
                      <th className="px-4 py-3 font-black">Polizze</th>
                      <th className="px-4 py-3 font-black">Premio</th>
                      <th className="px-4 py-3 font-black">Provvigioni</th>
                      <th className="px-4 py-3 font-black">Nota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {weeklyQuietanzaRecords.map(record => (
                      <tr key={record.id} className="hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-bold text-slate-900 whitespace-nowrap">
                          {formatDate(record.quietanzaDate)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-bold text-slate-900">{record.clientName}</p>
                          <p className="text-xs text-slate-500 max-w-[220px] truncate">{record.address || 'Indirizzo assente'}</p>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <StarRating stars={record.starLevel} compact />
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="font-bold text-slate-900">{record.sourceCode}</span>
                          <p className="text-xs">{record.sourceName}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                          {formatDate(record.birthDate)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          {record.phone ? (
                            <a
                              href={`tel:${record.phone}`}
                              className="inline-flex items-center gap-1 font-bold text-[#003781]"
                            >
                              <Phone size={14} />
                              {record.phone}
                            </a>
                          ) : (
                            <span className="text-slate-400">Telefono assente</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700 whitespace-nowrap">
                          {formatTenure(record.customerTenure)}
                        </td>
                        <td className="px-4 py-3 font-black text-slate-900">{record.policyCount}</td>
                        <td className="px-4 py-3 font-bold text-slate-700 whitespace-nowrap">
                          {formatMoney(record.annualPremium)}
                        </td>
                        <td className="px-4 py-3 font-black text-slate-900 whitespace-nowrap">
                          {formatMoney(record.agencyCommissions)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 min-w-[180px]">
                          {record.recommendation || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string;
  label: string;
}) {
  return (
    <div className="p-4 border-b sm:border-r sm:border-b-0 border-slate-200 last:border-r-0">
      <Icon size={22} className="text-[#003781] mb-4" />
      <p className="text-2xl font-black text-slate-900 tracking-normal">{value}</p>
      <p className="text-sm font-bold text-slate-500 mt-1">{label}</p>
    </div>
  );
}

function StarRating({
  stars,
  compact = false,
}: {
  stars: number;
  compact?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-0.5" aria-label={`${stars} stelle`}>
      {Array.from({ length: 6 }).map((_, index) => {
        const active = index < stars;
        return (
          <Star
            key={index}
            size={compact ? 13 : 15}
            className={active ? 'text-amber-500' : 'text-slate-300'}
            fill={active ? 'currentColor' : 'none'}
          />
        );
      })}
    </div>
  );
}

function parseSafeDate(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : undefined;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : parseSafeDate(value);
  if (!date) return '-';
  return format(date, 'dd/MM/yyyy', { locale: it });
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatTenure(value: number): string {
  if (!value) return '-';
  const rounded = Math.round(value * 10) / 10;
  return `${rounded} anni`;
}
