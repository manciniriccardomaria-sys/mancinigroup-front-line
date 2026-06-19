import React, { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import {
  CATEGORY_SECTIONS,
  DailyReport,
  CategoryId,
  createEmptyCategoryCounts,
} from '../constants';
import { getItalyDate } from '../lib/utils';
import { 
  LogOut, 
  Plus, 
  Minus, 
  Calendar, 
  CalendarDays,
  ClipboardList,
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import EmployeeCallCalendar from './EmployeeCallCalendar';

export default function EmployeeDashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [today, setToday] = useState(() => getItalyDate());
  const [selectedView, setSelectedView] = useState<'calendar' | 'report'>('calendar');

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
        await setDoc(reportRef, {
          userId: initialReport.userId,
          userName: initialReport.userName,
          date: initialReport.date,
        }, { merge: true });

        if (cancelled) return;

        unsubscribe = onSnapshot(reportRef, (docSnap) => {
          const storedReport = docSnap.exists()
            ? docSnap.data() as Partial<DailyReport>
            : {};
          const normalizedReport = {
            ...initialReport,
            ...storedReport,
            emissMotorSe: storedReport.emissMotorSe ?? storedReport.emissSe ?? 0,
            sinistriRetail: storedReport.sinistriRetail ?? storedReport.sinistriRamiVari ?? 0,
            contattiProtection: storedReport.contattiProtection ?? storedReport.contattiVita ?? 0,
          };

          setReport(normalizedReport);
          setError('');
          setLoading(false);
        }, (snapshotError) => {
          console.error('Error loading daily report:', snapshotError);
          setError(getReportErrorMessage(snapshotError));
          setLoading(false);
        });
      } catch (initializationError) {
        console.error('Error initializing daily report:', initializationError);
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

  const updateCount = async (categoryId: CategoryId, delta: number) => {
    if (!report || !auth.currentUser) return;

    const newValue = Math.max(0, (report[categoryId as keyof DailyReport] as number) + delta);
    const updatedReport = {
      ...report,
      [categoryId]: newValue
    };

    setSaving(true);
    const reportId = `${auth.currentUser.uid}_${today}`;
    try {
      await setDoc(doc(db, 'daily_reports', reportId), updatedReport);
    } catch (saveError) {
      console.error('Error saving daily report:', saveError);
      setError(getReportErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#003781]"></div>
      </div>
    );
  }

  if (error) {
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
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
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

      <main className="max-w-5xl mx-auto px-4 mt-6">
        <div className="mb-5 inline-flex bg-white border border-slate-200 p-1 rounded-lg">
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
          </button>
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
        </div>

        {selectedView === 'calendar' && <EmployeeCallCalendar />}

        {selectedView === 'report' && (
          <>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
            <h2 className="font-semibold text-slate-700">Rendicontazione Giornaliera</h2>
            {saving && <span className="text-xs text-blue-600 animate-pulse font-medium">Salvataggio...</span>}
          </div>

          <div>
            {CATEGORY_SECTIONS.map((section, sectionIndex) => (
              <section
                key={section.id}
                className={sectionIndex > 0 ? 'border-t-4 border-slate-100' : ''}
              >
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                  <h3 className="text-sm font-bold text-slate-700 uppercase">
                    {section.title}
                  </h3>
                </div>

                <div className="divide-y divide-slate-100">
                  {section.categories.map(cat => (
                    <div
                      key={cat.id}
                      className="p-4 flex items-center justify-between gap-3 hover:bg-slate-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-lg bg-slate-100 shrink-0 ${cat.color}`}>
                          <cat.icon size={22} />
                        </div>
                        <div className="min-w-0">
                          <span className="block font-medium text-slate-700">{cat.label}</span>
                        </div>
                      </div>

                      <div className="flex items-center bg-slate-100 rounded-xl p-1 shrink-0">
                        <button
                          onClick={() => updateCount(cat.id, -1)}
                          className="p-2 hover:bg-white hover:text-red-600 rounded-lg transition-all active:scale-90 disabled:opacity-30"
                          disabled={report?.[cat.id] === 0}
                          title={`Diminuisci ${cat.label}`}
                        >
                          <Minus size={18} />
                        </button>
                        <div className="w-10 sm:w-12 text-center font-bold text-lg text-slate-800">
                          {report?.[cat.id] || 0}
                        </div>
                        <button
                          onClick={() => updateCount(cat.id, 1)}
                          className="p-2 hover:bg-white hover:text-green-600 rounded-lg transition-all active:scale-90"
                          title={`Aumenta ${cat.label}`}
                        >
                          <Plus size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-100 rounded-2xl p-6 flex items-start gap-4">
          <div className="bg-blue-600 p-2 rounded-full text-white">
            <CheckCircle2 size={20} />
          </div>
          <div>
            <h3 className="font-bold text-blue-900">Ottimo lavoro!</h3>
            <p className="text-blue-700 text-sm mt-1">
              Ogni click viene salvato istantaneamente. I dati sono visibili solo agli agenti nella dashboard di riepilogo.
            </p>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
}

function createInitialReport(userId: string, userName: string, date: string): DailyReport {
  return {
    userId,
    userName,
    date,
    ...createEmptyCategoryCounts(),
  };
}

function getReportErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error && 'code' in error
    ? String(error.code)
    : '';

  if (code.includes('permission-denied')) {
    return 'Firebase ha rifiutato l\'accesso. Pubblica le regole Firestore aggiornate e riprova.';
  }

  return 'Non e stato possibile caricare il report giornaliero. Controlla la connessione e riprova.';
}
