import React, { useEffect, useState } from 'react';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { CATEGORIES, DailyReport, CategoryId } from '../constants';
import { formatDate } from '../lib/utils';
import { 
  LogOut, 
  Plus, 
  Minus, 
  Calendar, 
  User as UserIcon,
  CheckCircle2
} from 'lucide-react';

export default function EmployeeDashboard() {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const today = formatDate(new Date());

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    const reportId = `${user.uid}_${today}`;
    const unsubscribe = onSnapshot(doc(db, 'daily_reports', reportId), (docSnap) => {
      if (docSnap.exists()) {
        setReport(docSnap.data() as DailyReport);
      } else {
        const initialReport: DailyReport = {
          userId: user.uid,
          userName: user.displayName || 'Utente',
          date: today,
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
        setReport(initialReport);
      }
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `daily_reports/${reportId}`);
    });

    return () => unsubscribe();
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
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `daily_reports/${reportId}`);
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
