import React, { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { CATEGORIES, DailyReport, CategoryId } from '../constants';
import { formatDate } from '../lib/utils';
import { 
  LogOut, 
  Plus, 
  Minus, 
  Calendar, 
  User as UserIcon,
  CheckCircle2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

export default function EmployeeDashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const today = formatDate(new Date());

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

          setReport({ ...initialReport, ...storedReport });
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
                {new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })}
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

      <main className="max-w-4xl mx-auto px-4 mt-6">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 bg-slate-50 border-bottom border-slate-200 flex justify-between items-center">
            <h2 className="font-semibold text-slate-700">Rendicontazione Giornaliera</h2>
            {saving && <span className="text-xs text-blue-600 animate-pulse font-medium">Salvataggio...</span>}
          </div>

          <div className="divide-y divide-slate-100">
            {CATEGORIES.map((cat) => (
              <div key={cat.id} className="p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-xl bg-slate-100 ${cat.color}`}>
                    <cat.icon size={22} />
                  </div>
                  <span className="font-medium text-slate-700">{cat.label}</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="flex items-center bg-slate-100 rounded-xl p-1">
                    <button
                      onClick={() => updateCount(cat.id as CategoryId, -1)}
                      className="p-2 hover:bg-white hover:text-red-600 rounded-lg transition-all active:scale-90 disabled:opacity-30"
                      disabled={report?.[cat.id as keyof DailyReport] === 0}
                    >
                      <Minus size={18} />
                    </button>
                    <div className="w-12 text-center font-bold text-lg text-slate-800">
                      {report?.[cat.id as keyof DailyReport] || 0}
                    </div>
                    <button
                      onClick={() => updateCount(cat.id as CategoryId, 1)}
                      className="p-2 hover:bg-white hover:text-green-600 rounded-lg transition-all active:scale-90"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
              </div>
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
      </main>
    </div>
  );
}

function createInitialReport(userId: string, userName: string, date: string): DailyReport {
  return {
    userId,
    userName,
    date,
    incassi: 0,
    recensioni: 0,
    prevMotorSe: 0,
    prevMotorTerzi: 0,
    prevRetailSe: 0,
    prevRetailTerzi: 0,
    emissSe: 0,
    emissTerzi: 0,
    sinistriMotor: 0,
    sinistriRamiVari: 0,
    midCorporate: 0,
    contattiVita: 0,
    contattiFondoPensione: 0,
    contattiEnergia: 0,
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
