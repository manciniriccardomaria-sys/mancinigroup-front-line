import React, { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import {
  BellRing,
  CheckCircle2,
  Loader2,
  Pencil,
  Plus,
  Power,
  Trash2,
  X,
} from 'lucide-react';
import { auth, db } from '../firebase';
import { Notice } from '../constants';

type NoticeDraft = {
  id?: string;
  title: string;
  body: string;
  active: boolean;
};

const EMPTY_NOTICE: NoticeDraft = {
  title: '',
  body: '',
  active: true,
};

export default function AdminNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [draft, setDraft] = useState<NoticeDraft>(EMPTY_NOTICE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => onSnapshot(collection(db, 'notices'), snapshot => {
    setNotices(
      snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as Notice))
        .sort((first, second) => getTimestamp(second.updatedAt || second.createdAt) -
          getTimestamp(first.updatedAt || first.createdAt))
    );
  }), []);

  const saveNotice = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.title.trim() || !draft.body.trim()) return;

    setSaving(true);
    setError('');
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      active: draft.active,
      createdBy: auth.currentUser?.displayName || auth.currentUser?.email || 'Agente',
      updatedAt: serverTimestamp(),
    };

    try {
      if (draft.id) {
        await updateDoc(doc(db, 'notices', draft.id), payload);
      } else {
        await addDoc(collection(db, 'notices'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setDraft(EMPTY_NOTICE);
    } catch (saveError) {
      console.error('Error saving notice:', saveError);
      setError('Non è stato possibile salvare l’avviso.');
    } finally {
      setSaving(false);
    }
  };

  const editNotice = (notice: Notice) => {
    setDraft({
      id: notice.id,
      title: notice.title,
      body: notice.body,
      active: notice.active,
    });
  };

  const toggleNotice = async (notice: Notice) => {
    await updateDoc(doc(db, 'notices', notice.id), {
      active: !notice.active,
      updatedAt: serverTimestamp(),
    });
  };

  const removeNotice = async (notice: Notice) => {
    if (!window.confirm(`Eliminare l’avviso “${notice.title}”?`)) return;
    await deleteDoc(doc(db, 'notices', notice.id));
    if (draft.id === notice.id) setDraft(EMPTY_NOTICE);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
      <section className="space-y-3">
        {notices.length === 0 && (
          <div className="bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500">
            Nessun avviso pubblicato.
          </div>
        )}

        {notices.map(notice => (
          <article
            key={notice.id}
            className="bg-white border border-slate-200 rounded-lg p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-bold text-slate-800">{notice.title}</h3>
                  <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded ${
                    notice.active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {notice.active ? 'Pubblicato' : 'Nascosto'}
                  </span>
                </div>
                <p className="mt-3 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                  {notice.body}
                </p>
                <p className="mt-4 text-xs text-slate-400">
                  {notice.createdBy}
                  {formatNoticeDate(notice.updatedAt || notice.createdAt) &&
                    ` · ${formatNoticeDate(notice.updatedAt || notice.createdAt)}`}
                </p>
              </div>

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => toggleNotice(notice)}
                  className={`p-2 rounded-lg ${
                    notice.active
                      ? 'text-emerald-600 hover:bg-emerald-50'
                      : 'text-slate-400 hover:bg-slate-100'
                  }`}
                  title={notice.active ? 'Nascondi avviso' : 'Pubblica avviso'}
                >
                  <Power size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => editNotice(notice)}
                  className="p-2 text-slate-500 hover:text-[#003781] hover:bg-slate-100 rounded-lg"
                  title="Modifica avviso"
                >
                  <Pencil size={17} />
                </button>
                <button
                  type="button"
                  onClick={() => removeNotice(notice)}
                  className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  title="Elimina avviso"
                >
                  <Trash2 size={17} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>

      <form
        onSubmit={saveNotice}
        className="bg-white border border-slate-200 rounded-lg p-5 space-y-4 xl:sticky xl:top-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BellRing size={20} className="text-[#003781]" />
            <h3 className="font-bold text-slate-800">
              {draft.id ? 'Modifica avviso' : 'Nuovo avviso'}
            </h3>
          </div>
          {draft.id && (
            <button
              type="button"
              onClick={() => setDraft(EMPTY_NOTICE)}
              className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg"
              title="Annulla modifica"
            >
              <X size={17} />
            </button>
          )}
        </div>

        <label className="block">
          <span className="text-xs font-bold text-slate-600">Titolo</span>
          <input
            value={draft.title}
            onChange={event => setDraft(previous => ({
              ...previous,
              title: event.target.value,
            }))}
            maxLength={120}
            required
            className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
          />
        </label>

        <label className="block">
          <span className="text-xs font-bold text-slate-600">Testo</span>
          <textarea
            value={draft.body}
            onChange={event => setDraft(previous => ({
              ...previous,
              body: event.target.value,
            }))}
            maxLength={3000}
            required
            className="mt-1 w-full min-h-44 resize-y border border-slate-300 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
          />
        </label>

        <label className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3">
          <span>
            <strong className="block text-sm text-slate-700">Pubblica subito</strong>
            <span className="block text-xs text-slate-500">Visibile nella tab Avvisi.</span>
          </span>
          <input
            type="checkbox"
            checked={draft.active}
            onChange={event => setDraft(previous => ({
              ...previous,
              active: event.target.checked,
            }))}
            className="w-5 h-5 accent-[#003781]"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-[#003781] text-white py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving
            ? <Loader2 size={17} className="animate-spin" />
            : draft.id
              ? <CheckCircle2 size={17} />
              : <Plus size={17} />}
          {draft.id ? 'Salva modifiche' : 'Pubblica avviso'}
        </button>
      </form>
    </div>
  );
}

function getTimestamp(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }
  return 0;
}

function formatNoticeDate(value: unknown): string {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    return value.toDate().toLocaleDateString('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }
  return '';
}
