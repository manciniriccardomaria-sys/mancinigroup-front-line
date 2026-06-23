import React, { useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  Check,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  REPORT_COLOR_OPTIONS,
  REPORT_ICON_OPTIONS,
  REPORT_SECTIONS,
  ReportCategory,
  ReportColorId,
  ReportIconId,
  ReportSectionId,
  getReportCategoryIcon,
} from '../reportCatalog';

type CategoryDraft = {
  id?: string;
  label: string;
  sectionId: ReportSectionId;
  iconKey: ReportIconId;
  color: ReportColorId;
};

const EMPTY_DRAFT: CategoryDraft = {
  label: '',
  sectionId: 'reception',
  iconKey: 'clipboard-check',
  color: 'text-blue-600',
};

export default function AdminReportCategories({
  categories,
}: {
  categories: ReportCategory[];
}) {
  const [draft, setDraft] = useState<CategoryDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const PreviewIcon = getReportCategoryIcon(draft.iconKey);

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.label.trim()) return;

    setSaving(true);
    setError('');
    const currentCategory = categories.find(category => category.id === draft.id);
    const payload = {
      label: draft.label.trim(),
      sectionId: draft.sectionId,
      iconKey: draft.iconKey,
      color: draft.color,
      order: currentCategory?.order ||
        Math.max(0, ...categories.map(category => category.order)) + 10,
      updatedAt: serverTimestamp(),
    };

    try {
      if (draft.id) {
        await updateDoc(doc(db, 'report_categories', draft.id), payload);
      } else {
        await addDoc(collection(db, 'report_categories'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setDraft(EMPTY_DRAFT);
    } catch (saveError) {
      console.error('Error saving report category:', saveError);
      setError('Non è stato possibile salvare la voce.');
    } finally {
      setSaving(false);
    }
  };

  const editCategory = (category: ReportCategory) => {
    setDraft({
      id: category.id,
      label: category.label,
      sectionId: category.sectionId,
      iconKey: category.iconKey,
      color: category.color,
    });
  };

  const removeCategory = async (category: ReportCategory) => {
    if (!window.confirm(
      `Eliminare “${category.label}” dalla rendicontazione? I dati storici resteranno conservati.`
    )) return;
    await deleteDoc(doc(db, 'report_categories', category.id));
    if (draft.id === category.id) setDraft(EMPTY_DRAFT);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200">
        <h3 className="font-bold text-slate-800">Voci della rendicontazione</h3>
        <p className="text-sm text-slate-500 mt-1">
          Aggiungi, modifica o rimuovi le attività mostrate nel Front Line.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="p-4 border-b xl:border-b-0 xl:border-r border-slate-200">
          <div className="space-y-5">
            {REPORT_SECTIONS.map(section => {
              const sectionCategories = categories.filter(
                category => category.sectionId === section.id
              );
              if (sectionCategories.length === 0) return null;

              return (
                <div key={section.id}>
                  <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">
                    {section.title}
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {sectionCategories.map(category => {
                      const Icon = getReportCategoryIcon(category.iconKey);
                      return (
                        <div
                          key={category.id}
                          className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className={`p-2 rounded-md bg-slate-100 shrink-0 ${category.color}`}>
                              <Icon size={18} />
                            </div>
                            <span className="text-sm font-semibold text-slate-700">
                              {category.label}
                            </span>
                          </div>
                          <div className="flex shrink-0">
                            <button
                              type="button"
                              onClick={() => editCategory(category)}
                              className="p-2 text-slate-500 hover:text-[#003781] hover:bg-slate-100 rounded-lg"
                              title="Modifica voce"
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeCategory(category)}
                              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                              title="Elimina voce"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {categories.length === 0 && (
              <div className="border border-dashed border-slate-300 rounded-lg py-12 text-center text-slate-500">
                Nessuna voce configurata.
              </div>
            )}
          </div>
        </div>

        <form onSubmit={saveCategory} className="p-5 space-y-5 bg-slate-50">
          <div className="flex items-center justify-between">
            <h4 className="font-bold text-slate-800">
              {draft.id ? 'Modifica voce' : 'Nuova voce'}
            </h4>
            {draft.id && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY_DRAFT)}
                className="p-1.5 text-slate-500 hover:bg-white rounded-lg"
                title="Annulla modifica"
              >
                <X size={17} />
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-3">
            <div className={`p-2 rounded-md bg-slate-100 ${draft.color}`}>
              <PreviewIcon size={20} />
            </div>
            <div>
              <span className="block text-[10px] uppercase font-bold text-slate-400">
                Anteprima
              </span>
              <span className="block text-sm font-semibold text-slate-700">
                {draft.label || 'Nome della nuova voce'}
              </span>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">Nome voce</span>
            <input
              value={draft.label}
              onChange={event => setDraft(previous => ({
                ...previous,
                label: event.target.value,
              }))}
              maxLength={100}
              required
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781]"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-600">Sezione</span>
            <select
              value={draft.sectionId}
              onChange={event => setDraft(previous => ({
                ...previous,
                sectionId: event.target.value as ReportSectionId,
              }))}
              className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781]"
            >
              {REPORT_SECTIONS.map(section => (
                <option key={section.id} value={section.id}>{section.title}</option>
              ))}
            </select>
          </label>

          <fieldset>
            <legend className="text-xs font-bold text-slate-600 mb-2">Icona</legend>
            <div className="grid grid-cols-7 gap-2">
              {REPORT_ICON_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDraft(previous => ({
                    ...previous,
                    iconKey: option.id,
                  }))}
                  className={`aspect-square flex items-center justify-center rounded-md border ${
                    draft.iconKey === option.id
                      ? 'bg-[#003781] text-white border-[#003781]'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'
                  }`}
                  title={option.label}
                >
                  <option.icon size={17} />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-bold text-slate-600 mb-2">Colore icona</legend>
            <div className="flex flex-wrap gap-2">
              {REPORT_COLOR_OPTIONS.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setDraft(previous => ({
                    ...previous,
                    color: option.id,
                  }))}
                  className={`w-8 h-8 rounded-md border-2 flex items-center justify-center ${
                    draft.color === option.id
                      ? 'border-slate-800'
                      : 'border-transparent'
                  }`}
                  title={option.label}
                >
                  <span className={`w-5 h-5 rounded ${option.swatch}`} />
                </button>
              ))}
            </div>
          </fieldset>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-[#003781] text-white py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {draft.id ? <Check size={17} /> : <Plus size={17} />}
            {saving
              ? 'Salvataggio...'
              : draft.id
                ? 'Salva modifiche'
                : 'Aggiungi voce'}
          </button>
        </form>
      </div>
    </section>
  );
}
