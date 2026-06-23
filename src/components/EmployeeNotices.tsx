import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { BellRing } from 'lucide-react';
import { db } from '../firebase';
import { Notice } from '../constants';

export default function EmployeeNotices() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onSnapshot(collection(db, 'notices'), snapshot => {
    setNotices(snapshot.docs.map(item => ({
      id: item.id,
      ...item.data(),
    } as Notice)));
    setLoading(false);
  }), []);

  const activeNotices = useMemo(
    () => notices
      .filter(notice => notice.active)
      .sort((first, second) => getTimestamp(second.updatedAt || second.createdAt) -
        getTimestamp(first.updatedAt || first.createdAt)),
    [notices]
  );

  if (loading) {
    return <div className="py-20 text-center text-slate-500">Caricamento avvisi...</div>;
  }

  return (
    <section className="space-y-3">
      {activeNotices.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-lg py-16 text-center text-slate-500">
          <BellRing size={28} className="mx-auto mb-3 text-slate-300" />
          Nessun avviso pubblicato.
        </div>
      )}

      {activeNotices.map(notice => (
        <article
          key={notice.id}
          className="bg-white border border-slate-200 rounded-lg overflow-hidden"
        >
          <div className="flex items-start gap-3 p-5">
            <div className="p-2.5 rounded-lg bg-blue-50 text-[#003781] shrink-0">
              <BellRing size={20} />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-slate-800">{notice.title}</h2>
              <p className="mt-2 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {notice.body}
              </p>
              <p className="mt-4 text-xs text-slate-400">
                {notice.createdBy}
                {formatNoticeDate(notice.updatedAt || notice.createdAt) &&
                  ` · ${formatNoticeDate(notice.updatedAt || notice.createdAt)}`}
              </p>
            </div>
          </div>
        </article>
      ))}
    </section>
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
