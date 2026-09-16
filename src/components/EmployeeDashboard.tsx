import React, { useEffect, useMemo, useState } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { it } from 'date-fns/locale';
import { auth, db } from '../firebase';
import { collection, doc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import {
  DailyReport,
  DailyObjectives,
  CategoryId,
  createEmptyDailyObjectives,
  getAuthorizedEmployee,
  getReportCategoryValue,
} from '../constants';
import {
  ReportCategory,
  getReportCategoryIcon,
  useReportCategories,
} from '../reportCatalog';
import { getItalyDate } from '../lib/utils';
import { 
  LogOut, 
  Plus, 
  Minus, 
  Calendar, 
  CalendarDays,
  ClipboardList,
  History,
  Target,
  User as UserIcon,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import EmployeeCallCalendar from './EmployeeCallCalendar';
import {
  Campaign,
  CallTask,
  isCampaignTaskEligible,
  isTaskActionable,
} from '../callCenter';
import { isCallCategoryEnabled } from '../callWorkflowConfig';
import { subscribeToCallTasksForEmployee } from '../callTaskSubscriptions';

export default function EmployeeDashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [objectives, setObjectives] = useState<DailyObjectives>(
    createEmptyDailyObjectives
  );
  const [callTasks, setCallTasks] = useState<CallTask[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState('');
  const [today, setToday] = useState(() => getItalyDate());
  const [selectedView, setSelectedView] = useState<'calendar' | 'report'>('report');
  const [showReportHistory, setShowReportHistory] = useState(false);
  const [historyDate, setHistoryDate] = useState(() =>
    format(subDays(parseISO(getItalyDate()), 1), 'yyyy-MM-dd')
  );
  const [historyReport, setHistoryReport] = useState<DailyReport | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const {
    categories,
    sections,
    loading: categoriesLoading,
  } = useReportCategories();
  const employee = getAuthorizedEmployee(auth.currentUser?.email);

  useEffect(() => {
    const updateDate = () => setToday(getItalyDate());
    const interval = window.setInterval(updateDate, 60_000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setError('Sessione non disponibile. Esci e accedi nuovamente.');
      setLoading(false);
      return;
    }

    const reportId = `${user.uid}_${today}`;
    const reportRef = doc(db, 'daily_reports', reportId);
    const initialReport = createInitialReport(user.uid, user.displayName || 'Utente', today);
    let unsubscribe: Unsubscribe | undefined;
    let cancelled = false;

    const initializeReport = async () => {
      try {
        // Creating the document first avoids a denied read when today's report
        // does not exist yet under owner-only Firestore rules.
        await withTimeout(setDoc(reportRef, {
          userId: initialReport.userId,
          userName: initialReport.userName,
          date: initialReport.date,
        }, { merge: true }), 12000);

        if (cancelled) return;

        unsubscribe = onSnapshot(reportRef, (docSnap) => {
          const storedReport = docSnap.exists()
            ? docSnap.data() as Partial<DailyReport>
            : {};
          const normalizedReport = normalizeDailyReport(initialReport, storedReport);

          setReport(normalizedReport);
          setError('');
          setLoading(false);
        }, (snapshotError) => {
          console.error('Error loading daily report:', snapshotError);
          setReport(previous => previous || initialReport);
          setError(getReportErrorMessage(snapshotError));
          setLoading(false);
        });
      } catch (initializationError) {
        console.error('Error initializing daily report:', initializationError);
        setReport(initialReport);
        setError(getReportErrorMessage(initializationError));
        setLoading(false);
      }
    };

    initializeReport();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [today]);

  useEffect(() => {
    const user = auth.currentUser;
    if (!showReportHistory || !user || !historyDate) {
      setHistoryLoading(false);
      return;
    }

    const initialReport = createInitialReport(
      user.uid,
      user.displayName || 'Utente',
      historyDate,
    );
    const reportRef = doc(db, 'daily_reports', `${user.uid}_${historyDate}`);
    setHistoryLoading(true);
    setHistoryError('');

    return onSnapshot(reportRef, snapshot => {
      setHistoryReport(snapshot.exists()
        ? normalizeDailyReport(
            initialReport,
            snapshot.data() as Partial<DailyReport>,
          )
        : null
      );
      setHistoryLoading(false);
      setHistoryError('');
    }, snapshotError => {
      console.error('Error loading report history:', snapshotError);
      setHistoryReport(null);
      setHistoryLoading(false);
      setHistoryError('Non è stato possibile caricare lo storico della giornata selezionata.');
    });
  }, [showReportHistory, historyDate]);

  useEffect(() => onSnapshot(
    doc(db, 'daily_objectives', 'current'),
    snapshot => {
      const stored = snapshot.exists()
        ? snapshot.data() as Partial<DailyObjectives> & Record<string, unknown>
        : {};
      const baseValues = {
        ...(stored.values || {}),
        ...Object.fromEntries(
          categories
            .filter(category => typeof stored[category.id] === 'number')
            .map(category => [category.id, stored[category.id] as number])
        ),
      };
      const userObjectives = auth.currentUser?.uid && stored.byUser
        ? stored.byUser[auth.currentUser.uid]
        : undefined;

      setObjectives({
        ...createEmptyDailyObjectives(),
        enabled: stored.enabled === true,
        values: userObjectives?.values || baseValues,
        byUser: stored.byUser || {},
        updatedBy: stored.updatedBy,
        updatedAt: stored.updatedAt,
      });
    }
  ), [categories]);

  useEffect(() => subscribeToCallTasksForEmployee(
    employee?.sourceCodes || [],
    auth.currentUser?.uid || '',
    setCallTasks,
    callError => {
      console.error('Error loading call notification count:', callError);
    },
  ), [employee]);

  useEffect(() => onSnapshot(collection(db, 'campaigns'), snapshot => {
    setCampaigns(snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
    } as Campaign)));
  }), []);

  const calendarNotificationCount = useMemo(() => {
    const ownSourceCodes = employee?.sourceCodes || [];
    const currentUid = auth.currentUser?.uid || '';
    const activeCampaignsById = new Map(
      campaigns
        .filter(campaign => campaign.active)
        .map(campaign => [campaign.id, campaign])
    );

    return callTasks.filter(task => {
      const campaign = task.campaignId
        ? activeCampaignsById.get(task.campaignId)
        : undefined;
      const isEnabled = isCallCategoryEnabled(task.category) &&
        (
          task.category !== 'campagna' ||
          Boolean(campaign && isCampaignTaskEligible(task, campaign))
        );
      const isOwnOrAssigned = ownSourceCodes.some(code => code === task.sourceCode) ||
        task.assignedToUid === currentUid;

      return isEnabled && isOwnOrAssigned && isTaskActionable(task, today);
    }).length;
  }, [callTasks, campaigns, employee, today]);

  const updateCount = async (categoryId: CategoryId, delta: number) => {
    if (!report || !auth.currentUser) return;

    const newValue = Math.max(
      0,
      getReportCategoryValue(report, categoryId) + delta
    );
    const updatedReport = {
      ...report,
      values: {
        ...(report.values || {}),
        [categoryId]: newValue,
      },
    };

    setSaving(true);
    const reportId = `${auth.currentUser.uid}_${today}`;
    try {
      await setDoc(doc(db, 'daily_reports', reportId), updatedReport, { merge: true });
    } catch (saveError) {
      console.error('Error saving daily report:', saveError);
      setError(getReportErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading || categoriesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#003781]"></div>
      </div>
    );
  }

  if (error && !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
          <div className="bg-red-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="text-red-600" size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 mb-2">Report non disponibile</h1>
          <p className="text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="flex items-center justify-center gap-2 w-full bg-[#003781] text-white py-3 rounded-xl font-semibold hover:bg-[#002a63] transition-colors"
          >
            <RefreshCw size={20} />
            Riprova
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-12">
      {/* Header */}
      <header className="bg-[#003781] text-white sticky top-0 z-10 shadow-md">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-white/10 p-2 rounded-lg">
              <UserIcon size={20} />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-none">{auth.currentUser?.displayName}</h1>
              <p className="text-blue-200 text-xs mt-1 flex items-center gap-1">
                <Calendar size={12} />
                {new Date().toLocaleDateString('it-IT', {
                  timeZone: 'Europe/Rome',
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                })}
              </p>
            </div>
          </div>
          <button 
            onClick={() => auth.signOut()}
            className="p-2 hover:bg-white/10 rounded-lg transition-colors"
            title="Logout"
          >
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 mt-4">
        {error && (
          <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
            {error} Le modifiche al report potrebbero non essere salvate finché Firestore non torna disponibile.
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 sm:grid-cols-2 bg-white border border-slate-200 p-1 rounded-lg w-full sm:w-fit">
          <button
            type="button"
            onClick={() => setSelectedView('report')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold ${
              selectedView === 'report'
                ? 'bg-[#003781] text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <ClipboardList size={17} />
            Report giornaliero
          </button>
          <button
            type="button"
            onClick={() => setSelectedView('calendar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-bold ${
              selectedView === 'calendar'
                ? 'bg-[#003781] text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <CalendarDays size={17} />
            Calendario chiamate
            {calendarNotificationCount > 0 && (
              <span className={`ml-1 inline-flex min-w-5 h-5 items-center justify-center rounded-full px-1.5 text-[11px] font-black ${
                selectedView === 'calendar'
                  ? 'bg-white text-[#003781]'
                  : 'bg-red-600 text-white'
              }`}>
                {calendarNotificationCount}
              </span>
            )}
          </button>
        </div>

        {selectedView === 'calendar' && <EmployeeCallCalendar />}

        {selectedView === 'report' && (
          <section className="space-y-3">
            {!showReportHistory && objectives.enabled && report && (
              <DailyObjectivesPanel
                objectives={objectives}
                report={report}
                categories={categories}
              />
            )}

            <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-800">
                  {showReportHistory ? 'Storico attività svolte' : 'Rendicontazione giornaliera'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {showReportHistory
                    ? 'Consulta i report delle giornate precedenti in sola lettura.'
                    : 'Ogni variazione viene salvata automaticamente.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {!showReportHistory && (
                  <span className={`text-xs font-bold whitespace-nowrap ${
                    saving ? 'text-blue-600 animate-pulse' : 'text-emerald-600'
                  }`}>
                    {saving ? 'Salvataggio...' : 'Dati salvati'}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setShowReportHistory(previous => !previous)}
                  className={`inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold border ${
                    showReportHistory
                      ? 'bg-[#003781] border-[#003781] text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <History size={16} />
                  {showReportHistory ? 'Torna a oggi' : 'Vedi storico'}
                </button>
              </div>
            </div>

            {showReportHistory ? (
              <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
                  <div>
                    <label htmlFor="report-history-date" className="block text-xs font-bold text-slate-600 mb-1.5">
                      Seleziona la giornata
                    </label>
                    <input
                      id="report-history-date"
                      type="date"
                      value={historyDate}
                      max={today}
                      onChange={event => {
                        if (event.target.value) setHistoryDate(event.target.value);
                      }}
                      className="border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white"
                    />
                  </div>
                  <p className="text-xs font-semibold text-slate-500 capitalize">
                    {format(parseISO(historyDate), 'EEEE d MMMM yyyy', { locale: it })}
                  </p>
                </div>

                {historyLoading ? (
                  <div className="py-14 text-center text-sm text-slate-500">
                    Caricamento storico...
                  </div>
                ) : historyError ? (
                  <div className="m-4 bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
                    {historyError}
                  </div>
                ) : historyReport ? (
                  <HistoricalActivities report={historyReport} categories={categories} />
                ) : (
                  <div className="py-14 px-4 text-center">
                    <History size={28} className="mx-auto text-slate-300 mb-2" />
                    <p className="font-bold text-slate-700">Nessuna attività registrata</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Non esiste un report per la giornata selezionata.
                    </p>
                  </div>
                )}
              </section>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
                {sections.map(section => (
                  <section
                    key={section.id}
                    className="bg-white border border-slate-200 rounded-lg overflow-hidden"
                  >
                    <div className="px-3 py-2.5 bg-slate-50 border-b border-slate-200 min-h-11 flex items-center">
                      <h3 className="text-xs font-bold text-slate-700 uppercase">
                        {section.title}
                      </h3>
                    </div>

                    <div className="divide-y divide-slate-100">
                      {section.categories.map(cat => {
                        const CategoryIcon = getReportCategoryIcon(cat.iconKey);
                        const value = report
                          ? getReportCategoryValue(report, cat.id)
                          : 0;

                        return (
                          <div
                            key={cat.id}
                            className="px-3 py-2 flex items-center justify-between gap-2 hover:bg-slate-50/70 transition-colors"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`p-1.5 rounded-md bg-slate-100 shrink-0 ${cat.color}`}>
                                <CategoryIcon size={17} />
                              </div>
                              <span className="block text-sm font-medium text-slate-700 leading-tight">
                                {cat.label}
                              </span>
                            </div>

                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
                              <button
                                onClick={() => updateCount(cat.id, -1)}
                                className="p-1.5 hover:bg-white hover:text-red-600 rounded-md transition-all active:scale-90 disabled:opacity-30"
                                disabled={value === 0}
                                title={`Diminuisci ${cat.label}`}
                              >
                                <Minus size={16} />
                              </button>
                              <div className="w-8 text-center font-bold text-base text-slate-800">
                                {value}
                              </div>
                              <button
                                onClick={() => updateCount(cat.id, 1)}
                                className="p-1.5 hover:bg-white hover:text-green-600 rounded-md transition-all active:scale-90"
                                title={`Aumenta ${cat.label}`}
                              >
                                <Plus size={16} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
                {sections.length === 0 && (
                  <div className="lg:col-span-3 bg-white border border-dashed border-slate-300 rounded-lg py-12 text-center text-slate-500">
                    Nessuna voce di rendicontazione configurata.
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

function DailyObjectivesPanel({
  objectives,
  report,
  categories,
}: {
  objectives: DailyObjectives;
  report: DailyReport;
  categories: ReportCategory[];
}) {
  const visibleObjectives = categories
    .filter(category => (objectives.values[category.id] || 0) > 0);

  if (visibleObjectives.length === 0) return null;

  return (
    <section className="bg-white border border-blue-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
        <Target size={19} className="text-[#003781]" />
        <div>
          <h2 className="font-bold text-slate-800">Obiettivi di oggi</h2>
          <p className="text-xs text-slate-500">Avanzamento della rendicontazione giornaliera.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 divide-y sm:divide-y-0 border-slate-100">
        {visibleObjectives.map(category => {
          const target = objectives.values[category.id] || 0;
          const current = getReportCategoryValue(report, category.id);
          const progress = Math.min(100, Math.round((current / target) * 100));
          const CategoryIcon = getReportCategoryIcon(category.iconKey);

          return (
            <div
              key={category.id}
              className="p-3 border-slate-100 sm:border-b xl:border-b-0 sm:border-r last:border-r-0"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-md bg-slate-100 shrink-0 ${category.color}`}>
                    <CategoryIcon size={17} />
                  </div>
                  <span className="text-sm font-semibold text-slate-700 leading-tight">
                    {category.label}
                  </span>
                </div>
                <span className={`text-sm font-black whitespace-nowrap ${
                  current >= target ? 'text-emerald-600' : 'text-[#003781]'
                }`}>
                  {current}/{target}
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={current >= target ? 'h-full bg-emerald-500' : 'h-full bg-[#003781]'}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function HistoricalActivities({
  report,
  categories,
}: {
  report: DailyReport;
  categories: ReportCategory[];
}) {
  const activities = categories
    .map(category => ({
      category,
      value: getReportCategoryValue(report, category.id),
    }))
    .filter(activity => activity.value > 0);
  const total = activities.reduce((sum, activity) => sum + activity.value, 0);

  if (activities.length === 0) {
    return (
      <div className="py-14 px-4 text-center">
        <History size={28} className="mx-auto text-slate-300 mb-2" />
        <p className="font-bold text-slate-700">Nessuna attività svolta</p>
        <p className="text-xs text-slate-500 mt-1">
          Il report della giornata è presente, ma non contiene attività registrate.
        </p>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-700">Attività registrate</p>
        <span className="bg-blue-50 text-[#003781] px-3 py-1.5 rounded-lg text-xs font-black">
          Totale {total}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {activities.map(({ category, value }) => {
          const CategoryIcon = getReportCategoryIcon(category.iconKey);

          return (
            <div
              key={category.id}
              className="border border-slate-200 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className={`p-1.5 rounded-md bg-slate-100 shrink-0 ${category.color}`}>
                  <CategoryIcon size={17} />
                </div>
                <span className="text-sm font-medium text-slate-700 leading-tight">
                  {category.label}
                </span>
              </div>
              <span className="min-w-8 text-center text-base font-black text-slate-800">
                {value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function createInitialReport(userId: string, userName: string, date: string): DailyReport {
  return {
    userId,
    userName,
    date,
    values: {},
  };
}

function normalizeDailyReport(
  initialReport: DailyReport,
  storedReport: Partial<DailyReport>,
): DailyReport {
  return {
    ...initialReport,
    ...storedReport,
    values: storedReport.values || {},
    emissMotorSe: storedReport.emissMotorSe ?? storedReport.emissSe ?? 0,
    sinistriRetail: storedReport.sinistriRetail ?? storedReport.sinistriRamiVari ?? 0,
    contattiProtection: storedReport.contattiProtection ?? storedReport.contattiVita ?? 0,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new Error('firestore-timeout')), timeoutMs);
    }),
  ]);
}

function getReportErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : '';

  if (code.includes('permission-denied')) {
    return 'Firebase ha rifiutato l\'accesso. Pubblica le regole Firestore aggiornate e riprova.';
  }

  if (code.includes('resource-exhausted')) {
    return 'Firestore ha esaurito o sta aggiornando la capacità disponibile.';
  }

  if (code.includes('unavailable') || code.includes('deadline-exceeded')) {
    return 'Firestore non è temporaneamente raggiungibile.';
  }

  if (error instanceof Error && error.message === 'firestore-timeout') {
    return 'Firestore sta impiegando troppo tempo a rispondere.';
  }

  return 'Non è stato possibile caricare il report giornaliero.';
}
