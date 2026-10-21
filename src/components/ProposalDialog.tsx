import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { getItalyDate } from '../lib/utils';
import { getAuthorizedEmployee } from '../constants';
import { auth } from '../firebase';
import { SOURCE_DIRECTORY } from '../sourceDirectory';
import type { ReportCategory } from '../reportCatalog';
import { isValidFiscalCode, normalizeFiscalCode, validateCustomer, type CustomerDetails } from '../negotiationModel';
import { createNegotiationId, findNegotiationCustomer, getNegotiationErrorMessage, saveNegotiation, saveVitarivDelivery } from '../negotiations';

const EMPTY_CUSTOMER: CustomerDetails = { fiscalCode: '', firstName: '', lastName: '', birthDate: '' };
const inputClass = 'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600';

export default function ProposalDialog({ category, onClose }: { category: ReportCategory; onClose: () => void }) {
  const isDelivery = category.id === 'vitarivConsegna';
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fiscalCodeRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [id] = useState(createNegotiationId);
  const [proposalDate] = useState(getItalyDate);
  const [customer, setCustomer] = useState<CustomerDetails>(EMPTY_CUSTOMER);
  const sources = SOURCE_DIRECTORY.filter(source => getAuthorizedEmployee(auth.currentUser?.email)?.sourceCodes.includes(source.code));
  const [sourceKey, setSourceKey] = useState(sources.length === 1 ? `${sources[0].code}|${sources[0].name}` : '');
  const [lookupStatus, setLookupStatus] = useState<'idle' | 'searching' | 'found' | 'missing' | 'error'>('idle');
  const [lookupNote, setLookupNote] = useState('');
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    fiscalCodeRef.current?.focus();
    return () => dialog?.close();
  }, []);

  useEffect(() => {
    if (!isValidFiscalCode(customer.fiscalCode)) return;
    let cancelled = false;
    setLookupStatus('searching');
    setLookupNote('');
    const timer = window.setTimeout(async () => {
      try {
        const match = await findNegotiationCustomer(customer.fiscalCode);
        if (cancelled) return;
        if (match) {
          setCustomer(previous => ({ ...previous, firstName: match.firstName, lastName: match.lastName, birthDate: match.birthDate }));
          setLookupStatus('found');
          setLookupNote(match.notice || (match.needsNameReview
            ? `Cliente trovato: ${match.originalName}. Verifica la separazione di nome e cognome${match.birthDate ? '.' : ' e completa la data di nascita.'}`
            : `Anagrafica trovata e compilata. ${match.birthDate ? 'Puoi correggere i dati prima di salvare.' : 'Completa la data di nascita mancante.'}`));
        } else {
          setLookupStatus('missing');
          setLookupNote('Cliente non trovato. Compila l’anagrafica del cliente.');
        }
      } catch (lookupError) {
        if (cancelled) return;
        setLookupStatus('error');
        setLookupNote(`Ricerca non riuscita: ${getNegotiationErrorMessage(lookupError)} Puoi riprovare o compilare i dati manualmente.`);
      }
    }, 350);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [customer.fiscalCode, lookupAttempt]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current || lookupStatus === 'searching') return;
    const validation = validateCustomer(customer, getItalyDate());
    if (validation) { setError(validation); return; }
    const source = sources.find(item => `${item.code}|${item.name}` === sourceKey);
    if (!source) { setError('Seleziona la fonte dell’attività.'); return; }
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const saveActivity = isDelivery ? saveVitarivDelivery : saveNegotiation;
      await saveActivity({ id, customer, categoryId: category.id, proposalLabel: category.label, proposalDate, sourceCode: source.code, sourceName: source.name });
      onClose();
    } catch (saveError) {
      setError(getNegotiationErrorMessage(saveError));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <dialog ref={dialogRef} aria-labelledby="proposal-dialog-title" onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-xl max-h-[90dvh] overflow-y-auto rounded-2xl p-0 bg-white shadow-2xl backdrop:bg-slate-900/50"
    >
      <form onSubmit={submit}>
        <div className="flex justify-between items-start gap-4 px-6 py-5 border-b border-slate-200">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Account di test · {isDelivery ? 'Consegna Vitariv' : 'Nuova proposta'}</p>
            <h2 id="proposal-dialog-title" className="text-xl font-bold text-slate-800 mt-1">Dati del cliente</h2>
            <p className="text-sm text-slate-500 mt-1">{isDelivery ? 'Compila l’anagrafica e salva per registrare la consegna.' : 'Salva la trattativa per registrare l’attività.'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Chiudi scheda cliente" className="p-2 rounded-lg hover:bg-slate-100 disabled:opacity-40"><X size={20} /></button>
        </div>
        <fieldset disabled={saving} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-3 rounded-lg">
            <label className="text-xs font-bold text-slate-600">{isDelivery ? 'Consegna' : 'Proposta'}
              <input aria-label={isDelivery ? 'Consegna' : 'Proposta'} value={category.label} readOnly className={`${inputClass} mt-1 !bg-slate-100`} />
            </label>
            <label className="text-xs font-bold text-slate-600">{isDelivery ? 'Data della consegna' : 'Data della proposta'}
              <input aria-label={isDelivery ? 'Data della consegna' : 'Data della proposta'} type="date" value={proposalDate} readOnly className={`${inputClass} mt-1 !bg-slate-100`} />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Fonte
            <select required value={sourceKey} onChange={event => setSourceKey(event.target.value)} className={`${inputClass} mt-1`}>
              <option value="">Seleziona fonte</option>
              {sources.map(source => <option key={`${source.code}|${source.name}`} value={`${source.code}|${source.name}`}>{source.code} · {source.name}</option>)}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">Codice fiscale
            <input ref={fiscalCodeRef} autoFocus required autoComplete="off" spellCheck={false} maxLength={16} value={customer.fiscalCode} placeholder="Inserisci il codice fiscale"
              onChange={event => {
                const fiscalCode = normalizeFiscalCode(event.target.value);
                setCustomer({ ...EMPTY_CUSTOMER, fiscalCode });
                setLookupStatus(isValidFiscalCode(fiscalCode) ? 'searching' : 'idle');
                setLookupNote('');
                setError('');
              }} className={`${inputClass} mt-1 uppercase`} />
          </label>
          <div aria-live="polite" className={`text-xs rounded-lg ${lookupStatus === 'found' ? 'text-blue-800 bg-blue-50 p-3' : lookupStatus === 'error' ? 'text-amber-800 bg-amber-50 p-3' : 'text-slate-500'}`}>
            {lookupStatus === 'searching' ? <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" />Ricerca cliente nel database...</span> : lookupNote || 'L’anagrafica si compila automaticamente se il cliente è già presente.'}
            {lookupStatus === 'error' && <button type="button" onClick={() => setLookupAttempt(previous => previous + 1)} className="block mt-2 font-bold underline">Riprova ricerca</button>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm font-semibold text-slate-700">Nome
              <input required maxLength={99} disabled={lookupStatus === 'searching'} value={customer.firstName} onChange={event => setCustomer(previous => ({ ...previous, firstName: event.target.value }))} className={`${inputClass} mt-1`} />
            </label>
            <label className="text-sm font-semibold text-slate-700">Cognome
              <input required maxLength={99} disabled={lookupStatus === 'searching'} value={customer.lastName} onChange={event => setCustomer(previous => ({ ...previous, lastName: event.target.value }))} className={`${inputClass} mt-1`} />
            </label>
          </div>
          <label className="block text-sm font-semibold text-slate-700">Data di nascita
            <input required type="date" max={getItalyDate()} disabled={lookupStatus === 'searching'} value={customer.birthDate} onChange={event => setCustomer(previous => ({ ...previous, birthDate: event.target.value }))} className={`${inputClass} mt-1`} />
          </label>
          {error && <p role="alert" className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</p>}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2.5 border border-slate-300 bg-white rounded-lg text-sm font-bold disabled:opacity-40">Annulla</button>
          <button type="submit" disabled={saving || lookupStatus === 'searching'} className="flex items-center gap-2 px-4 py-2.5 bg-[#003781] text-white rounded-lg text-sm font-bold disabled:opacity-40">
            {saving ? <Loader2 size={17} className="animate-spin" /> : <CheckCircle2 size={17} />}{saving ? 'Salvataggio...' : isDelivery ? 'Salva consegna' : 'Salva proposta'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
