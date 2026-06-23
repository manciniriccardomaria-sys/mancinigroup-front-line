import React, { useEffect, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Check,
  Minus,
  Plus,
  Save,
  Target,
} from 'lucide-react';
import {
  CATEGORY_SECTIONS,
  CATEGORIES,
  CategoryId,
  DailyObjectives,
  createEmptyDailyObjectives,
} from '../constants';
import { auth, db } from '../firebase';

export default function AdminDailyObjectives() {
  const [objectives, setObjectives] = useState<DailyObjectives>(
    createEmptyDailyObjectives
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(
    doc(db, 'daily_objectives', 'current'),
    snapshot => {
      const stored = snapshot.exists()
        ? snapshot.data() as Partial<DailyObjectives>
        : {};
      setObjectives({
        ...createEmptyDailyObjectives(),
        ...stored,
      });
    }
  ), []);

  const updateObjective = (categoryId: CategoryId, value: number) => {
    setSaved(false);
    setObjectives(previous => ({
      ...previous,
      [categoryId]: Math.max(0, Math.floor(value || 0)),
    }));
  };

  const saveObjectives = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await setDoc(doc(db, 'daily_objectives', 'current'), {
        ...objectives,
        updatedBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Agente',
        updatedAt: serverTimestamp(),
      });
      setSaved(true);
    } catch (saveError) {
      console.error('Error saving daily objectives:', saveError);
      setError('Non è stato possibile salvare gli obiettivi.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = CATEGORIES
    .filter(category => objectives[category.id] > 0).length;

  return (
    <div className="space-y-5">
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-blue-50 text-[#003781] rounded-lg">
            <Target size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Obiettivi giornalieri Front Line</h3>
            <p className="text-sm text-slate-500 mt-1">
              Le voci impostate a zero non vengono mostrate alle dipendenti.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 cursor-pointer">
          <span className="text-right">
            <strong className="block text-sm text-slate-700">
              {objectives.enabled ? 'Obiettivi attivi' : 'Obiettivi disattivati'}
            </strong>
            <span className="block text-xs text-slate-500">
              {activeCount} voci configurate
            </span>
          </span>
          <span className={`relative w-11 h-6 rounded-full transition-colors ${
            objectives.enabled ? 'bg-[#003781]' : 'bg-slate-300'
          }`}>
            <input
              type="checkbox"
              checked={objectives.enabled}
              onChange={event => {
                setSaved(false);
                setObjectives(previous => ({
                  ...previous,
                  enabled: event.target.checked,
                }));
              }}
              className="sr-only"
            />
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
              objectives.enabled ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </span>
        </label>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        {CATEGORY_SECTIONS.map(section => (
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
              {section.categories.map(category => {
                const value = objectives[category.id] || 0;
                return (
                  <div
                    key={category.id}
                    className={`px-3 py-2 flex items-center justify-between gap-2 ${
                      value > 0 ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`p-1.5 rounded-md bg-slate-100 shrink-0 ${category.color}`}>
                        <category.icon size={17} />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-sm font-medium text-slate-700 leading-tight">
                          {category.label}
                        </span>
                        <span className={`text-[10px] font-semibold ${
                          value > 0 ? 'text-[#003781]' : 'text-slate-400'
                        }`}>
                          {value > 0 ? 'Visibile nel Front Line' : 'Non mostrato'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => updateObjective(category.id, value - 1)}
                        disabled={value === 0}
                        className="p-1.5 hover:bg-white hover:text-red-600 rounded-md disabled:opacity-30"
                        title={`Diminuisci ${category.label}`}
                      >
                        <Minus size={16} />
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={value}
                        onChange={event => updateObjective(
                          category.id,
                          Number(event.target.value)
                        )}
                        className="w-10 text-center font-bold text-sm bg-transparent outline-none"
                        aria-label={`Obiettivo ${category.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => updateObjective(category.id, value + 1)}
                        className="p-1.5 hover:bg-white hover:text-emerald-600 rounded-md"
                        title={`Aumenta ${category.label}`}
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
      </div>

      <div className="sticky bottom-4 bg-white border border-slate-200 rounded-lg p-3 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {!error && saved && (
            <p className="text-sm text-emerald-700 flex items-center gap-2">
              <Check size={16} />
              Obiettivi salvati.
            </p>
          )}
          {!error && !saved && (
            <p className="text-xs text-slate-500">
              Salva per rendere effettive le modifiche nel Front Line.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={saveObjectives}
          disabled={saving}
          className="bg-[#003781] text-white px-5 py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <Save size={17} />
          {saving ? 'Salvataggio...' : 'Salva obiettivi'}
        </button>
      </div>
    </div>
  );
}
