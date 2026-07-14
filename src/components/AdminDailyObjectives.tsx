import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  Check,
  Minus,
  Plus,
  Save,
  Target,
  Users,
} from 'lucide-react';
import {
  DailyObjectives,
  UserProfile,
  createEmptyDailyObjectives,
} from '../constants';
import { auth, db } from '../firebase';
import {
  getReportCategoryIcon,
  useReportCategories,
} from '../reportCatalog';
import AdminReportCategories from './AdminReportCategories';

export default function AdminDailyObjectives() {
  const [objectives, setObjectives] = useState<DailyObjectives>(
    createEmptyDailyObjectives
  );
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('all');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const { categories, sections, loading: categoriesLoading } = useReportCategories();

  useEffect(() => onSnapshot(collection(db, 'users'), snapshot => {
    setUsers(
      snapshot.docs
        .map(item => item.data() as UserProfile)
        .filter(user => user.role === 'employee')
        .sort((first, second) => first.name.localeCompare(second.name, 'it'))
    );
  }), []);

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

      setObjectives({
        ...createEmptyDailyObjectives(),
        enabled: stored.enabled === true,
        values: baseValues,
        byUser: stored.byUser || {},
        updatedBy: stored.updatedBy,
        updatedAt: stored.updatedAt,
      });
    }
  ), [categories]);

  useEffect(() => {
    if (
      selectedTarget !== 'all' &&
      !users.some(user => user.uid === selectedTarget)
    ) {
      setSelectedTarget('all');
    }
  }, [selectedTarget, users]);

  const selectedTargetValues = useMemo(
    () => getObjectiveValuesForTarget(objectives, selectedTarget),
    [objectives, selectedTarget]
  );

  const selectedTargetName = selectedTarget === 'all'
    ? 'tutte le fonti'
    : users.find(user => user.uid === selectedTarget)?.name || 'fonte selezionata';

  const updateObjective = (categoryId: string, value: number) => {
    setSaved(false);
    setObjectives(previous => ({
      ...previous,
      ...(selectedTarget === 'all'
        ? {
            values: {
              ...previous.values,
              [categoryId]: Math.max(0, Math.floor(value || 0)),
            },
          }
        : {
            byUser: {
              ...(previous.byUser || {}),
              [selectedTarget]: {
                ...(previous.byUser?.[selectedTarget] || {}),
                values: {
                  ...getObjectiveValuesForTarget(previous, selectedTarget),
                  [categoryId]: Math.max(0, Math.floor(value || 0)),
                },
              },
            },
          }),
    }));
  };

  const applySameObjectivesToAllSources = () => {
    setSaved(false);
    setSelectedTarget('all');
    setObjectives(previous => ({
      ...previous,
      byUser: {},
    }));
  };

  const saveObjectives = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      await setDoc(doc(db, 'daily_objectives', 'current'), {
        enabled: objectives.enabled,
        values: objectives.values,
        byUser: objectives.byUser || {},
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

  const activeCount = categories
    .filter(category => (selectedTargetValues[category.id] || 0) > 0).length;

  return (
    <div className="space-y-5">
      <AdminReportCategories categories={categories} />

      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-blue-50 text-[#003781] rounded-lg">
            <Target size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Obiettivi giornalieri Front Line</h3>
            <p className="text-sm text-slate-500 mt-1">
              Imposta obiettivi generali o personalizzati per singola fonte.
            </p>
          </div>
        </div>

        <label className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 cursor-pointer">
          <span className="text-right">
            <strong className="block text-sm text-slate-700">
              {objectives.enabled ? 'Obiettivi attivi' : 'Obiettivi disattivati'}
            </strong>
            <span className="block text-xs text-slate-500">
              {activeCount} voci configurate per {selectedTargetName}
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

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="mb-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-50 text-[#003781] rounded-lg">
              <Users size={19} />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Destinatario obiettivi</h3>
              <p className="text-sm text-slate-500 mt-1">
                Se una fonte non ha obiettivi personali, usa quelli di “tutte le fonti”.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={applySameObjectivesToAllSources}
            className="px-3 py-2 rounded-lg text-xs font-bold border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Applica uguale a tutte le fonti
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedTarget('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              selectedTarget === 'all'
                ? 'bg-[#003781] text-white border-[#003781]'
                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Tutte le fonti
          </button>
          {users.map(user => (
            <button
              key={user.uid}
              type="button"
              onClick={() => setSelectedTarget(user.uid)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                selectedTarget === user.uid
                  ? 'bg-[#003781] text-white border-[#003781]'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {user.name}
            </button>
          ))}
        </div>
      </section>

      {categoriesLoading && (
        <div className="py-10 text-center text-slate-500">
          Caricamento voci...
        </div>
      )}

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
              {section.categories.map(category => {
                const value = selectedTargetValues[category.id] || 0;
                const CategoryIcon = getReportCategoryIcon(category.iconKey);
                return (
                  <div
                    key={category.id}
                    className={`px-3 py-2 flex items-center justify-between gap-2 ${
                      value > 0 ? 'bg-blue-50/30' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`p-1.5 rounded-md bg-slate-100 shrink-0 ${category.color}`}>
                        <CategoryIcon size={17} />
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

function getObjectiveValuesForTarget(
  objectives: DailyObjectives,
  target: string,
): Record<string, number> {
  if (target === 'all') return objectives.values || {};
  return objectives.byUser?.[target]?.values || objectives.values || {};
}
