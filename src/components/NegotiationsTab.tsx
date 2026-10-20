import { useEffect, useMemo, useRef, useState } from 'react';
import { Handshake, Loader2, RotateCcw } from 'lucide-react';
import { getItalyDate } from '../lib/utils';
import {
  daysSinceProposal, EMPTY_NEGOTIATION_FILTERS, filterNegotiations,
  type Negotiation, type NegotiationFilters, type NegotiationStatus,
} from '../negotiationModel';
import { getNegotiationErrorMessage, setNegotiationStatus, subscribeToNegotiations } from '../negotiations';

const STATUS_LABELS: Record<NegotiationStatus, string> = { open: 'In corso', ko: 'KO', ok: 'OK' };
const filterClass = 'w-full mt-1 border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 bg-white';
const displayDate = (value: string) => value.split('-').reverse().join('/');

export default function NegotiationsTab() {
  const [items, setItems] = useState<Negotiation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const updatingRef = useRef(false);
  const [today, setToday] = useState(getItalyDate);
  const [filters, setFilters] = useState<NegotiationFilters>({ ...EMPTY_NEGOTIATION_FILTERS });
  useEffect(() => subscribeToNegotiations(data => {
    setItems(data); setLoading(false); setLoadError('');
  }, error => { setLoadError(getNegotiationErrorMessage(error)); setLoading(false); }), []);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(getItalyDate()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const filtered = useMemo(() => filterNegotiations(items, filters, today), [items, filters, today]);
  const sources = [...new Map(items.map(item => [`${item.sourceCode}|${item.sourceName}`, `${item.sourceCode} · ${item.sourceName}`])).entries()];
  const proposals = [...new Map(items.map(item => [item.categoryId, item.proposalLabel])).entries()];
  const setFilter = (key: keyof NegotiationFilters, value: string) => setFilters(previous => ({ ...previous, [key]: value }));
  const updateStatus = async (id: string, status: NegotiationStatus) => {
    if (updatingRef.current) return;
    updatingRef.current = true; setUpdatingId(id); setSaveError('');
    try { await setNegotiationStatus(id, status); }
    catch (error) { setSaveError(getNegotiationErrorMessage(error)); }
    finally { updatingRef.current = false; setUpdatingId(''); }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-bold text-xl text-slate-800"><Handshake size={22} className="text-[#003781]" />Trattative</h2>
          <p className="text-sm text-slate-500 mt-1">Proposte per fonte · {filtered.length} di {items.length} trattative</p>
        </div>
        <span className="rounded-full px-3 py-1 bg-amber-100 text-amber-800 text-xs font-bold">Dati di test</span>
      </div>
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="text-xs font-bold text-slate-600">Cliente o codice fiscale
            <input value={filters.search} onChange={event => setFilter('search', event.target.value)} placeholder="Nome, cognome o CF" className={filterClass} />
          </label>
          <label className="text-xs font-bold text-slate-600">Fonte
            <select value={filters.source} onChange={event => setFilter('source', event.target.value)} className={filterClass}><option value="">Tutte le fonti</option>{sources.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </label>
          <label className="text-xs font-bold text-slate-600">Proposta
            <select value={filters.categoryId} onChange={event => setFilter('categoryId', event.target.value)} className={filterClass}><option value="">Tutte le proposte</option>{proposals.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
          </label>
          <label className="text-xs font-bold text-slate-600">Stato
            <select value={filters.status} onChange={event => setFilter('status', event.target.value)} className={filterClass}><option value="all">Tutti gli stati</option><option value="open">In corso</option><option value="ok">OK</option><option value="ko">KO</option></select>
          </label>
          <label className="text-xs font-bold text-slate-600">Proposta dal
            <input type="date" value={filters.dateFrom} onChange={event => setFilter('dateFrom', event.target.value)} className={filterClass} />
          </label>
          <label className="text-xs font-bold text-slate-600">Proposta al
            <input type="date" value={filters.dateTo} onChange={event => setFilter('dateTo', event.target.value)} className={filterClass} />
          </label>
          <label className="text-xs font-bold text-slate-600">Data di nascita
            <input type="date" value={filters.birthDate} onChange={event => setFilter('birthDate', event.target.value)} className={filterClass} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs font-bold text-slate-600">Giorni min.
              <input type="number" min="0" step="1" value={filters.minDays} onChange={event => setFilter('minDays', event.target.value)} className={filterClass} />
            </label>
            <label className="text-xs font-bold text-slate-600">Giorni max.
              <input type="number" min="0" step="1" value={filters.maxDays} onChange={event => setFilter('maxDays', event.target.value)} className={filterClass} />
            </label>
          </div>
        </div>
        <button type="button" onClick={() => setFilters({ ...EMPTY_NEGOTIATION_FILTERS })} className="inline-flex gap-1.5 items-center text-xs font-bold text-blue-700 mt-4"><RotateCcw size={14} />Azzera filtri</button>
      </div>
      {(loadError || saveError) && <p role="alert" className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">{loadError || saveError}</p>}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {loading ? <p className="flex gap-2 justify-center py-12 text-sm text-slate-500"><Loader2 size={18} className="animate-spin" />Caricamento trattative...</p> : filtered.length === 0 ? (
          <div className="text-center py-14 px-4"><Handshake size={32} className="mx-auto text-slate-300 mb-3" /><p className="font-bold text-slate-700">{loadError ? 'Trattative non disponibili' : items.length ? 'Nessuna trattativa corrisponde ai filtri' : 'Nessuna proposta registrata'}</p><p className="text-sm text-slate-500 mt-1">{loadError ? 'Verifica l’accesso al database di test.' : 'Usa il + su una voce di proposta nel report giornaliero.'}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Fonte', 'Codice fiscale', 'Nome', 'Cognome', 'Data di nascita', 'Proposta', 'Data proposta', 'Giorni trascorsi', 'Stato', 'Esito'].map(label => <th key={label} scope="col" className="px-4 py-3 font-bold">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(item => <tr key={item.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-4"><span className="font-bold text-slate-700">{item.sourceCode}</span><span className="block text-xs text-slate-500">{item.sourceName}</span></td>
                  <td className="px-4 py-4 font-mono text-xs whitespace-nowrap">{item.fiscalCode}</td>
                  <td className="px-4 py-4">{item.firstName}</td><td className="px-4 py-4 font-semibold">{item.lastName}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{displayDate(item.birthDate)}</td><td className="px-4 py-4">{item.proposalLabel}</td>
                  <td className="px-4 py-4 whitespace-nowrap">{displayDate(item.proposalDate)}</td><td className="px-4 py-4 font-bold">{daysSinceProposal(item.proposalDate, today)}</td>
                  <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap ${item.status === 'ok' ? 'bg-emerald-100 text-emerald-800' : item.status === 'ko' ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{STATUS_LABELS[item.status]}</span></td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <button type="button" aria-label={`KO per ${item.firstName} ${item.lastName}`} aria-pressed={item.status === 'ko'} disabled={Boolean(updatingId) || Boolean(loadError) || item.status === 'ko'} onClick={() => updateStatus(item.id, 'ko')} className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg font-bold text-xs disabled:opacity-40">KO</button>
                      <button type="button" aria-label={`OK per ${item.firstName} ${item.lastName}`} aria-pressed={item.status === 'ok'} disabled={Boolean(updatingId) || Boolean(loadError) || item.status === 'ok'} onClick={() => updateStatus(item.id, 'ok')} className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg font-bold text-xs disabled:opacity-40">OK</button>
                      {updatingId === item.id && <Loader2 size={16} className="animate-spin text-blue-700" />}
                      {item.status !== 'open' && <button type="button" onClick={() => updateStatus(item.id, 'open')} disabled={Boolean(updatingId) || Boolean(loadError)} title="Riapri trattativa" aria-label={`Riapri trattativa per ${item.firstName} ${item.lastName}`} className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-40"><RotateCcw size={16} /></button>}
                    </div>
                  </td>
                </tr>)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
