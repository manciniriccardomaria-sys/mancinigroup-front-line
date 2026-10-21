import { useEffect, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { CheckCircle2, Database, FileSpreadsheet, Loader2, Search, Upload } from 'lucide-react';
import { db } from '../firebase';
import { CUSTOMER_REGISTRY_COLLECTION, CUSTOMER_REGISTRY_META_COLLECTION, normalizeTaxIdentifier, type CustomerRegistryRecord, type RegistryAnalysis } from '../customerRegistryModel';
import { importCustomerRegistry, type RegistryImportSummary } from '../customerRegistry';
import { parseCustomerRegistryWorkbook } from '../customerRegistryWorkbook';

const count = (value: number) => value.toLocaleString('it-IT');
const formatDate = (value: string) => value ? value.split('-').reverse().join('/') : 'Da completare';

export default function CustomerRegistryPanel() {
  const [summary, setSummary] = useState<RegistryImportSummary | null>(null);
  const [analysis, setAnalysis] = useState<RegistryAnalysis | null>(null);
  const [busy, setBusy] = useState<'analyzing' | 'importing' | ''>('');
  const busyRef = useRef(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<CustomerRegistryRecord | null | undefined>();
  const searchVersion = useRef(0);
  useEffect(() => onSnapshot(doc(db, CUSTOMER_REGISTRY_META_COLLECTION, 'current'), snapshot => {
    setSummary(snapshot.exists() ? snapshot.data() as RegistryImportSummary : null);
  }, error => setError(`Non è stato possibile leggere lo stato dell’archivio: ${error.message}`)), []);

  const analyze = async (file?: File) => {
    if (!file || busyRef.current) return;
    busyRef.current = true; setBusy('analyzing'); setError(''); setMessage(''); setAnalysis(null);
    try { setAnalysis(await parseCustomerRegistryWorkbook(file)); }
    catch (error) { setError(error instanceof Error ? error.message : 'File non leggibile.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const importFile = async () => {
    if (!analysis || busyRef.current) return;
    busyRef.current = true; setBusy('importing'); setError(''); setMessage(''); setProgress({ done: 0, total: 0 });
    try {
      const result = await importCustomerRegistry(analysis, (done, total) => setProgress({ done, total }));
      setMessage(`Importazione completata: ${count(result.created)} nuove, ${count(result.updated)} aggiornate, ${count(result.unchanged)} già presenti senza modifiche.`);
      setAnalysis(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Importazione non riuscita.'); }
    finally { busyRef.current = false; setBusy(''); }
  };
  const findCustomer = async () => {
    const version = ++searchVersion.current;
    const identifier = normalizeTaxIdentifier(search);
    if (!/^(?:[A-Z0-9]{16}|\d{11})$/.test(identifier)) { setError('Inserisci un CF di 16 caratteri o una P.IVA di 11 cifre.'); return; }
    setSearching(true); setError(''); setSearchResult(undefined);
    try {
      const snapshot = await getDoc(doc(db, CUSTOMER_REGISTRY_COLLECTION, identifier));
      if (version === searchVersion.current) setSearchResult(snapshot.exists() ? snapshot.data() as CustomerRegistryRecord : null);
    } catch (error) { if (version === searchVersion.current) setError(error instanceof Error ? error.message : 'Ricerca non riuscita.'); }
    finally { if (version === searchVersion.current) setSearching(false); }
  };

  return <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
    <div className="flex items-start gap-3"><Database size={24} className="text-[#003781] mt-1 shrink-0" /><div>
      <h3 className="font-bold text-lg text-slate-800">Anagrafica clienti</h3>
      <p className="text-sm text-slate-500 mt-1">Carica “Tutti i clienti” per compilare automaticamente l’anagrafica delle proposte tramite codice fiscale.</p>
    </div></div>
    {summary && <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-sm text-slate-700">
      <p><strong>{count(summary.totalArchiveRecords)} anagrafiche nell’archivio.</strong> Ultimo file: {summary.fileName}</p>
      <p className="text-xs mt-1">{count(summary.persons)} persone fisiche e {count(summary.companies)} aziende nel file · {summary.conflicts} identificativi discordanti · {summary.missingBirthDates} date di nascita da verificare o completare.</p>
    </div>}
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="border border-dashed border-slate-300 rounded-lg p-4 space-y-3">
        <label className="block text-sm font-bold text-slate-700"><span className="flex items-center gap-2 mb-2"><FileSpreadsheet size={17} />Carica anagrafica clienti (.xlsx)</span>
          <input type="file" accept=".xlsx" disabled={Boolean(busy)} onChange={event => { const file = event.target.files?.[0]; void analyze(file); event.target.value = ''; }} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-2 file:font-semibold file:text-blue-800 disabled:opacity-50" />
        </label>
        <p className="text-xs text-slate-500">Importa CF/P.IVA, nominativo, nascita, fonte e stato cliente. Aggiorna i clienti presenti nel file e conserva quelli già caricati. Non genera chiamate.</p>
      </div>
      <form onSubmit={event => { event.preventDefault(); void findCustomer(); }} className="border border-slate-200 rounded-lg p-4 space-y-2">
        <label className="block text-sm font-bold text-slate-700" htmlFor="registry-search">Verifica un cliente nell’archivio</label>
        <div className="flex gap-2"><input id="registry-search" autoComplete="off" value={search} onChange={event => { setSearch(event.target.value.toUpperCase()); setSearchResult(undefined); searchVersion.current += 1; setSearching(false); }} placeholder="Codice fiscale o partita IVA" className="w-full min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="submit" disabled={searching || !search.trim()} className="inline-flex gap-2 items-center px-3 py-2 bg-[#003781] text-white rounded-lg text-sm font-bold disabled:opacity-40">{searching ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}Cerca</button></div>
        <p className="text-xs text-slate-500">La ricerca controlla il dato salvato nel gestionale.</p>
      </form>
    </div>
    {busy === 'analyzing' && <p role="status" className="flex gap-2 items-center text-sm text-blue-700"><Loader2 size={17} className="animate-spin" />Analisi del file in corso...</p>}
    {analysis && <div className="bg-slate-50 rounded-lg border border-slate-200 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800">{analysis.fileName} · Foglio {analysis.sheetName}</p>
      <p className="text-sm text-slate-600">{count(analysis.rowCount)} righe · {count(analysis.records.length)} anagrafiche uniche · {analysis.duplicateRows} righe duplicate · {analysis.skippedRows} righe escluse.</p>
      <p className="text-sm text-slate-600">{count(analysis.persons)} persone fisiche · {count(analysis.companies)} aziende · {analysis.namesToReview} nominativi da verificare · {analysis.missingBirthDates} date di nascita mancanti o discordanti.</p>
      {analysis.conflicts > 0 && <p className="text-sm text-amber-800">{analysis.conflicts} CF/P.IVA hanno anagrafiche discordanti: saranno riconosciuti, con richiesta di verifica prima di compilare i dati.</p>}
      {(analysis.conflicts > 0 || analysis.issues.length > 0) && <details className="text-sm"><summary className="cursor-pointer font-semibold text-slate-600">Vedi righe da verificare</summary><div className="mt-2 max-h-56 overflow-auto space-y-2">
        {analysis.records.filter(record => record.hasConflicts).map(record => <div key={record.fiscalCode} className="p-2 bg-white rounded border border-amber-200"><strong>{record.fiscalCode}</strong>{record.alternatives.map(candidate => <p key={candidate.sourceRow} className="text-xs mt-1">Riga {candidate.sourceRow}: {candidate.clientName} · {formatDate(candidate.birthDate)}</p>)}</div>)}
        {analysis.issues.slice(0, 100).map(issue => <p key={`${issue.row}-${issue.message}`} className="text-xs">Riga {issue.row}: {issue.message}</p>)}
        {analysis.issues.length > 100 && <p className="text-xs">Mostrate le prime 100 segnalazioni di {analysis.issues.length}.</p>}
      </div></details>}
      <button type="button" onClick={importFile} disabled={Boolean(busy)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#003781] text-white text-sm font-bold disabled:opacity-40">{busy === 'importing' ? <Loader2 size={17} className="animate-spin" /> : <Upload size={17} />}{busy === 'importing' ? 'Importazione in corso...' : `Importa ${count(analysis.records.length)} anagrafiche`}</button>
    </div>}
    {busy === 'importing' && <div role="status" className="text-sm text-blue-700 space-y-1"><p>{progress.total ? `${count(progress.done)} di ${count(progress.total)} anagrafiche salvate` : 'Confronto con le anagrafiche già presenti...'}</p><progress className="w-full h-2" value={progress.done} max={progress.total || 1} /></div>}
    {message && <p role="status" className="flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800"><CheckCircle2 size={18} className="shrink-0" />{message}</p>}
    {error && <p role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</p>}
    {searchResult === null && <p className="text-sm text-slate-500">Cliente non presente nell’anagrafica caricata.</p>}
    {searchResult && <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-700 space-y-1">
      <p className="font-bold">{searchResult.clientName}</p><p>{searchResult.fiscalCode} · {searchResult.identifierKind === 'company' ? 'Azienda' : `Nascita: ${formatDate(searchResult.birthDate)}`}</p>
      {searchResult.identifierKind === 'person' && !searchResult.hasConflicts && <p>Nome: {searchResult.firstName || 'Da completare'} · Cognome: {searchResult.lastName || 'Da completare'}</p>}
      {searchResult.hasConflicts ? <><p className="font-semibold text-amber-800">Anagrafiche discordanti: verifica necessaria.</p>{searchResult.alternatives.map(candidate => <p key={candidate.sourceRow}>Riga {candidate.sourceRow}: {candidate.clientName} · {formatDate(candidate.birthDate)}</p>)}</> : searchResult.needsNameReview && <p className="text-amber-800">Verifica la separazione tra nome e cognome.</p>}
    </div>}
  </section>;
}
