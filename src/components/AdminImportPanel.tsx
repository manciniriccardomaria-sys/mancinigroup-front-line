import React, { useEffect, useMemo, useState } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import {
  AlertTriangle,
  CalendarClock,
  CalendarPlus,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  Campaign,
  CampaignKind,
  CallTask,
  ImportKind,
  ParsedImport,
  getCampaignKind,
  importCallTasks,
  parseClientWorkbook,
  syncCampaignTasks,
} from '../callCenter';
import { CLIENT_IMPORT_CONFIG } from '../clientImportConfig';
import {
  ParsedCustomerClusterImport,
  importCustomerClusters,
  parseCustomerClusterWorkbook,
} from '../customerClusters';
import { ImportColumnMapping } from '../importColumnResolver';
import { getItalyDate } from '../lib/utils';

type CampaignDraft = {
  id?: string;
  campaignKind: CampaignKind;
  name: string;
  description: string;
  monthsAfterStart: string;
  daysBeforeExpiration: string;
  startDate: string;
  active: boolean;
};

const EMPTY_CAMPAIGN: CampaignDraft = {
  campaignKind: 'newClients',
  name: '',
  description: '',
  monthsAfterStart: '3',
  daysBeforeExpiration: '45',
  startDate: CLIENT_IMPORT_CONFIG.expirations.scheduleRule.annualCampaignDefaultStartDate,
  active: true,
};

type UploadKind = ImportKind | 'customerClusters';

type ImportAnalysis =
  | { kind: ImportKind; parsed: ParsedImport[] }
  | { kind: 'customerClusters'; parsed: ParsedCustomerClusterImport };

type CoverageItem = {
  key: string;
  title: string;
  campaign?: Campaign;
  importKind: ImportKind;
  importLabel: string;
  coveredUntil: string;
  daysRemaining: number | null;
  taskCount: number;
};

const IMPORT_OPTIONS: Array<{
  kind: UploadKind;
  title: string;
  description: string;
}> = [
  {
    kind: 'newClients',
    title: 'Nuovi clienti',
    description: 'Genera una chiamata per ciascuna campagna attiva.',
  },
  {
    kind: 'expirations',
    title: 'Scadenze clienti',
    description: 'Memorizza le scadenze clienti e genera le campagne attive a X giorni dalla prossima scadenza.',
  },
  {
    kind: 'winback',
    title: 'Winback',
    description: 'Importa uno o più mesi e calcola il richiamo 10 giorni prima dell’anniversario.',
  },
  {
    kind: 'customerClusters',
    title: 'Cluster clienti',
    description: 'Aggiorna clienti, stelle, premi e provvigioni dall’export Estrazione.',
  },
];

export default function AdminImportPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(EMPTY_CAMPAIGN);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [syncingCampaignId, setSyncingCampaignId] = useState('');
  const [campaignError, setCampaignError] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [coverageTasksByKey, setCoverageTasksByKey] = useState<Record<string, CallTask[]>>({});
  const [coverageLoading, setCoverageLoading] = useState(true);
  const [coverageError, setCoverageError] = useState('');
  const [selectedImportKind, setSelectedImportKind] = useState<UploadKind | ''>('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [analyzingImport, setAnalyzingImport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importAnalysis, setImportAnalysis] = useState<ImportAnalysis | null>(null);
  const [importError, setImportError] = useState('');
  const [importMessage, setImportMessage] = useState('');

  useEffect(() => {
    return onSnapshot(collection(db, 'campaigns'), snapshot => {
      setCampaigns(
        snapshot.docs
          .map(item => ({ id: item.id, ...item.data() } as Campaign))
          .sort((first, second) => first.name.localeCompare(second.name, 'it'))
      );
    });
  }, []);

  const activeCampaigns = useMemo(
    () => campaigns.filter(campaign => campaign.active),
    [campaigns]
  );
  const activeNewClientCampaigns = useMemo(
    () => activeCampaigns.filter(campaign => getCampaignKind(campaign) === 'newClients'),
    [activeCampaigns]
  );

  useEffect(() => {
    const definitions = [
      ...activeCampaigns.map(campaign => ({
        key: `campaign:${campaign.id}`,
        field: 'campaignId',
        value: campaign.id,
      })),
      { key: 'winback', field: 'category', value: 'winback' },
    ];
    const loadedKeys = new Set<string>();
    let listening = true;

    setCoverageTasksByKey({});
    setCoverageLoading(true);
    setCoverageError('');

    const markLoaded = (key: string) => {
      loadedKeys.add(key);
      if (listening && loadedKeys.size === definitions.length) {
        setCoverageLoading(false);
      }
    };

    const unsubscribers = definitions.map(definition => onSnapshot(
      query(collection(db, 'call_tasks'), where(definition.field, '==', definition.value)),
      snapshot => {
        if (!listening) return;
        setCoverageTasksByKey(previous => ({
          ...previous,
          [definition.key]: snapshot.docs.map(item => ({
            id: item.id,
            ...item.data(),
          } as CallTask)),
        }));
        markLoaded(definition.key);
      },
      error => {
        console.error(`Coverage listener error (${definition.key}):`, error);
        if (!listening) return;
        setCoverageError('Non è stato possibile aggiornare la copertura di tutte le campagne.');
        markLoaded(definition.key);
      }
    ));

    return () => {
      listening = false;
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [activeCampaigns]);

  const coverageItems = useMemo<CoverageItem[]>(() => {
    const today = parseISO(getItalyDate());
    const buildCoverageItem = (
      key: string,
      title: string,
      importKind: ImportKind,
      importLabel: string,
      campaign?: Campaign,
    ): CoverageItem => {
      const tasks = coverageTasksByKey[key] || [];
      const coveredUntil = tasks.reduce((latest, task) => (
        task.dueDate?.match(/^\d{4}-\d{2}-\d{2}$/) && task.dueDate > latest
          ? task.dueDate
          : latest
      ), '');

      return {
        key,
        title,
        campaign,
        importKind,
        importLabel,
        coveredUntil,
        daysRemaining: coveredUntil
          ? differenceInCalendarDays(parseISO(coveredUntil), today)
          : null,
        taskCount: tasks.length,
      };
    };

    return [
      ...activeCampaigns.map(campaign => {
        const campaignKind = getCampaignKind(campaign);
        return buildCoverageItem(
          `campaign:${campaign.id}`,
          campaign.name,
          campaignKind === 'annualExpirations' ? 'expirations' : 'newClients',
          campaignKind === 'annualExpirations' ? 'Scadenze clienti' : 'Nuovi clienti',
          campaign,
        );
      }),
      buildCoverageItem('winback', 'Winback', 'winback', 'Winback'),
    ];
  }, [activeCampaigns, coverageTasksByKey]);

  const saveCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    setCampaignError('');
    setCampaignMessage('');

    const campaignKind = campaignDraft.campaignKind;
    const monthsAfterStart = Number(campaignDraft.monthsAfterStart);
    const daysBeforeExpiration = Number(campaignDraft.daysBeforeExpiration);
    if (!campaignDraft.name.trim()) {
      setCampaignError('Inserisci il nome della campagna.');
      return;
    }

    if (
      campaignKind === 'newClients' &&
      (!Number.isInteger(monthsAfterStart) || monthsAfterStart < 1)
    ) {
      setCampaignError('Inserisci un nome e un numero di mesi maggiore di zero.');
      return;
    }

    if (
      campaignKind === 'annualExpirations' &&
      (!Number.isInteger(daysBeforeExpiration) || daysBeforeExpiration < 1)
    ) {
      setCampaignError('Inserisci un numero di giorni maggiore di zero.');
      return;
    }

    if (
      campaignKind === 'annualExpirations' &&
      campaignDraft.startDate &&
      !campaignDraft.startDate.match(/^\d{4}-\d{2}-\d{2}$/)
    ) {
      setCampaignError('Inserisci una data di inizio valida.');
      return;
    }

    const activeWithoutCurrent = campaigns.filter(
      campaign => campaign.active &&
        campaign.id !== campaignDraft.id &&
        getCampaignKind(campaign) === 'newClients'
    ).length;
    if (campaignKind === 'newClients' && campaignDraft.active && activeWithoutCurrent >= 3) {
      setCampaignError('Possono esserci al massimo tre campagne nuovi clienti attive.');
      return;
    }

    let persistedCampaignId = '';
    setSavingCampaign(true);
    try {
      const payload = {
        name: campaignDraft.name.trim(),
        description: campaignDraft.description.trim(),
        campaignKind,
        monthsAfterStart: campaignKind === 'newClients' ? monthsAfterStart : 1,
        daysBeforeExpiration: campaignKind === 'annualExpirations' ? daysBeforeExpiration : 0,
        startDate: campaignKind === 'annualExpirations' ? campaignDraft.startDate : '',
        active: campaignDraft.active,
        updatedAt: serverTimestamp(),
      };

      let campaignId = campaignDraft.id;
      if (campaignId) {
        await setDoc(doc(db, 'campaigns', campaignDraft.id), payload, { merge: true });
      } else {
        const campaignRef = await addDoc(collection(db, 'campaigns'), {
          ...payload,
          createdAt: serverTimestamp(),
        });
        campaignId = campaignRef.id;
      }
      persistedCampaignId = campaignId;
      if (!campaignDraft.id) {
        setCampaignDraft(previous => ({ ...previous, id: campaignId }));
      }

      const result = await syncCampaignTasks({
        id: campaignId,
        ...payload,
      });
      setCampaignMessage(
        campaignDraft.active
          ? result.totalRows > 0
            ? `Campagna salvata: ${result.created} chiamate create, ${result.updated} aggiornate e ${result.unchanged} già presenti.`
            : campaignKind === 'annualExpirations'
              ? 'Campagna salvata. Importa il file Scadenze clienti per generare le chiamate.'
              : 'Campagna salvata. Importa il file Nuovi clienti per generare le chiamate.'
          : 'Campagna salvata come disattivata.'
      );
      setCampaignDraft(EMPTY_CAMPAIGN);
    } catch (error) {
      console.error('Error saving campaign:', error);
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setCampaignError(
        persistedCampaignId
          ? `La campagna è stata salvata, ma non è stato possibile sincronizzare le chiamate.${detail}`
          : `Non è stato possibile salvare la campagna.${detail}`
      );
    } finally {
      setSavingCampaign(false);
    }
  };

  const synchronizeCampaign = async (campaign: Campaign) => {
    setSyncingCampaignId(campaign.id);
    setCampaignError('');
    setCampaignMessage('');

    try {
      const result = await syncCampaignTasks(campaign);
      setCampaignMessage(
        result.totalRows > 0
          ? `${campaign.name}: ${result.created} chiamate create, ${result.updated} aggiornate e ${result.unchanged} già presenti.`
          : getCampaignKind(campaign) === 'annualExpirations'
            ? `${campaign.name}: importa il file Scadenze clienti per generare le chiamate.`
            : `${campaign.name}: importa il file Nuovi clienti per generare le chiamate.`
      );
    } catch (error) {
      console.error('Campaign synchronization error:', error);
      setCampaignError(error instanceof Error
        ? `Sincronizzazione non riuscita: ${error.message}`
        : 'Non è stato possibile sincronizzare le chiamate della campagna.');
    } finally {
      setSyncingCampaignId('');
    }
  };

  const editCampaign = (campaign: Campaign) => {
    const campaignKind = getCampaignKind(campaign);
    setCampaignDraft({
      id: campaign.id,
      campaignKind,
      name: campaign.name,
      description: campaign.description,
      monthsAfterStart: String(campaign.monthsAfterStart || 3),
      daysBeforeExpiration: String(campaign.daysBeforeExpiration || 45),
      startDate: campaign.startDate ||
        CLIENT_IMPORT_CONFIG.expirations.scheduleRule.annualCampaignDefaultStartDate,
      active: campaign.active,
    });
  };

  const removeCampaign = async (campaign: Campaign) => {
    if (!window.confirm(`Eliminare la campagna "${campaign.name}"?`)) return;
    await deleteDoc(doc(db, 'campaigns', campaign.id));
    if (campaignDraft.id === campaign.id) setCampaignDraft(EMPTY_CAMPAIGN);
  };

  const prepareImport = (kind: ImportKind) => {
    setSelectedImportKind(kind);
    setSelectedFiles([]);
    setImportAnalysis(null);
    setImportError('');
    setImportMessage('');
    window.setTimeout(() => {
      document.getElementById('import-upload')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  };

  const analyzeImport = async () => {
    if (!selectedImportKind || selectedFiles.length === 0) return;

    setAnalyzingImport(true);
    setImportAnalysis(null);
    setImportError('');
    setImportMessage('');

    try {
      if (selectedImportKind === 'customerClusters') {
        const parsed = await parseCustomerClusterWorkbook(selectedFiles[0]);
        setImportAnalysis({ kind: 'customerClusters', parsed });
        return;
      }

      const parsed = await Promise.all(
        selectedFiles.map(file =>
          parseClientWorkbook(file, selectedImportKind, campaigns)
        )
      );
      setImportAnalysis({ kind: selectedImportKind, parsed });
    } catch (error) {
      console.error('Import analysis error:', error);
      setImportError(error instanceof Error
        ? error.message
        : 'Non è stato possibile analizzare il file.');
    } finally {
      setAnalyzingImport(false);
    }
  };

  const confirmImport = async () => {
    if (!importAnalysis || hasInvalidAnalysis(importAnalysis)) return;

    setImporting(true);
    setImportError('');
    setImportMessage('');

    try {
      if (importAnalysis.kind === 'customerClusters') {
        const result = await importCustomerClusters(importAnalysis.parsed);
        setImportMessage([
          `${result.importedRecords} clienti letti`,
          `${result.created} nuovi`,
          `${result.updated} aggiornati`,
          `${result.unchanged} invariati`,
          `${result.duplicateRows} duplicati interni ignorati`,
          `${result.skippedRows} righe saltate`,
        ].join(' · '));
      } else {
        const totals = {
          created: 0,
          updated: 0,
          unchanged: 0,
          skippedRows: 0,
          storedClients: 0,
          storedExpirations: 0,
        };

        for (const parsed of importAnalysis.parsed) {
          const result = await importCallTasks(parsed);
          totals.created += result.created;
          totals.updated += result.updated;
          totals.unchanged += result.unchanged;
          totals.skippedRows += result.skippedRows;
          totals.storedClients += result.storedClients;
          totals.storedExpirations += result.storedExpirations;
        }

        setImportMessage([
          `${totals.created} nuove`,
          `${totals.updated} aggiornate`,
          `${totals.unchanged} invariate`,
          ...(importAnalysis.kind === 'newClients'
            ? [`${totals.storedClients} clienti memorizzati o aggiornati`]
            : []),
          ...(importAnalysis.kind === 'expirations'
            ? [`${totals.storedExpirations} scadenze memorizzate o aggiornate`]
            : []),
          `${totals.skippedRows} righe saltate`,
        ].join(' · '));
      }

      setImportAnalysis(null);
      setSelectedFiles([]);
    } catch (error) {
      console.error('Import error:', error);
      setImportError(error instanceof Error
        ? error.message
        : 'Importazione non riuscita.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <CalendarPlus className="text-[#003781]" size={22} />
          <div>
            <h3 className="font-bold text-slate-800">Campagne chiamate</h3>
            <p className="text-sm text-slate-500">
              Nuovi clienti: massimo tre campagne attive. Attualmente: {activeNewClientCampaigns.length}/3.
            </p>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <div className="space-y-3">
            {campaigns.length === 0 && (
              <div className="border border-dashed border-slate-300 p-6 text-sm text-slate-500 text-center rounded-lg">
                Nessuna campagna configurata.
              </div>
            )}

            {campaigns.map(campaign => (
              <div
                key={campaign.id}
                className="border border-slate-200 rounded-lg p-4 flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-slate-800">{campaign.name}</h4>
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      campaign.active
                        ? 'bg-emerald-50 text-emerald-700'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {campaign.active ? 'Attiva' : 'Disattivata'}
                    </span>
                    <span className="text-xs font-bold px-2 py-1 rounded bg-blue-50 text-[#003781]">
                      {getCampaignKind(campaign) === 'annualExpirations'
                        ? 'Scadenze clienti'
                        : 'Nuovi clienti'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{campaign.description || 'Nessuna descrizione'}</p>
                  <p className="text-xs font-semibold text-[#003781] mt-2">
                    {getCampaignKind(campaign) === 'annualExpirations'
                      ? `${campaign.daysBeforeExpiration || 0} giorni prima della scadenza${
                          campaign.startDate ? ` · dal ${formatDateForDisplay(campaign.startDate)}` : ''
                        }`
                      : `Dopo ${campaign.monthsAfterStart || 0} mesi dall’ingresso`}
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => synchronizeCampaign(campaign)}
                    disabled={!campaign.active || syncingCampaignId === campaign.id}
                    className="p-2 text-slate-500 hover:text-[#003781] hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed"
                    title={campaign.active
                      ? 'Sincronizza chiamate dai dati memorizzati'
                      : 'Attiva la campagna per sincronizzarla'}
                  >
                    <RefreshCw
                      size={17}
                      className={syncingCampaignId === campaign.id ? 'animate-spin' : ''}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => editCampaign(campaign)}
                    className="p-2 text-slate-500 hover:text-[#003781] hover:bg-slate-100 rounded-lg"
                    title="Modifica campagna"
                  >
                    <Pencil size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCampaign(campaign)}
                    className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                    title="Elimina campagna"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={saveCampaign} className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-slate-800">
                {campaignDraft.id ? 'Modifica campagna' : 'Nuova campagna'}
              </h4>
              {campaignDraft.id && (
                <button
                  type="button"
                  onClick={() => setCampaignDraft(EMPTY_CAMPAIGN)}
                  className="p-1.5 text-slate-500 hover:bg-white rounded-lg"
                  title="Annulla modifica"
                >
                  <X size={17} />
                </button>
              )}
            </div>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">Nome</span>
              <input
                value={campaignDraft.name}
                onChange={event => setCampaignDraft(previous => ({
                  ...previous,
                  name: event.target.value,
                }))}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                required
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">Tipo campagna</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([
                  ['newClients', 'Nuovi clienti'],
                  ['annualExpirations', 'Scadenze clienti'],
                ] as Array<[CampaignKind, string]>).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setCampaignDraft(previous => ({
                      ...previous,
                      campaignKind: kind,
                    }))}
                    className={`rounded-lg border px-3 py-2 text-sm font-bold transition-colors ${
                      campaignDraft.campaignKind === kind
                        ? 'border-[#003781] bg-blue-50 text-[#003781]'
                        : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-bold text-slate-600">Descrizione</span>
              <textarea
                value={campaignDraft.description}
                onChange={event => setCampaignDraft(previous => ({
                  ...previous,
                  description: event.target.value,
                }))}
                className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781] resize-y min-h-20"
              />
            </label>

            {campaignDraft.campaignKind === 'newClients' ? (
              <label className="block">
                <span className="text-xs font-bold text-slate-600">Mesi dall’ingresso</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={campaignDraft.monthsAfterStart}
                  onChange={event => setCampaignDraft(previous => ({
                    ...previous,
                    monthsAfterStart: event.target.value,
                  }))}
                  className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                  required
                />
              </label>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-[#003781]">
                  Questa campagna crea chiamate a X giorni dalla data in colonna AH.
                  Le chiamate calcolate prima della data inizio vengono escluse.
                </div>
                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Giorni prima della scadenza</span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={campaignDraft.daysBeforeExpiration}
                    onChange={event => setCampaignDraft(previous => ({
                      ...previous,
                      daysBeforeExpiration: event.target.value,
                    }))}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-bold text-slate-600">Data inizio</span>
                  <input
                    type="date"
                    value={campaignDraft.startDate}
                    onChange={event => setCampaignDraft(previous => ({
                      ...previous,
                      startDate: event.target.value,
                    }))}
                    className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#003781]"
                  />
                </label>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={campaignDraft.active}
                onChange={event => setCampaignDraft(previous => ({
                  ...previous,
                  active: event.target.checked,
                }))}
                className="w-4 h-4 accent-[#003781]"
              />
              Campagna attiva
            </label>

            {campaignError && <p className="text-sm text-red-600">{campaignError}</p>}
            {campaignMessage && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                {campaignMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={savingCampaign}
              className="w-full bg-[#003781] text-white rounded-lg py-2.5 font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {savingCampaign ? <Loader2 className="animate-spin" size={17} /> : <Plus size={17} />}
              {campaignDraft.id ? 'Salva modifiche' : 'Aggiungi campagna'}
            </button>
          </form>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-[#003781] rounded-lg">
            <CalendarClock size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Copertura dati campagne</h3>
            <p className="text-sm text-slate-500">
              La copertura è calcolata sull’ultima chiamata realmente generata per ogni campagna attiva.
            </p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {coverageLoading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="animate-spin" size={17} />
              Calcolo della copertura in corso…
            </div>
          )}

          {coverageError && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
              {coverageError}
            </p>
          )}

          {!coverageLoading && (
            <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
              {coverageItems.map(item => {
                const presentation = getCoveragePresentation(item.daysRemaining);
                return (
                  <article
                    key={item.key}
                    className={`rounded-lg border p-4 ${presentation.cardClass}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="font-bold text-slate-800 truncate">{item.title}</h4>
                        <p className="text-xs font-semibold text-slate-500 mt-1">
                          Caricamento: {item.importLabel}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-full ${presentation.badgeClass}`}>
                        {presentation.label}
                      </span>
                    </div>

                    <div className="mt-4">
                      {item.coveredUntil ? (
                        <>
                          <p className="text-sm text-slate-600">Coperti fino al</p>
                          <p className="text-xl font-extrabold text-slate-900 mt-0.5">
                            {formatDateForDisplay(item.coveredUntil)}
                          </p>
                        </>
                      ) : (
                        <p className="text-lg font-extrabold text-slate-900">
                          Nessuna chiamata disponibile
                        </p>
                      )}
                      <p className={`text-sm font-bold mt-2 ${presentation.messageClass}`}>
                        {describeCoverageDeadline(item.daysRemaining)}
                      </p>
                      {item.taskCount > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          {item.taskCount} chiamate generate complessivamente
                        </p>
                      )}
                    </div>

                    <div className="mt-4 space-y-2">
                      {!item.coveredUntil && item.campaign && (
                        <button
                          type="button"
                          onClick={() => synchronizeCampaign(item.campaign!)}
                          disabled={syncingCampaignId === item.campaign.id}
                          className="w-full rounded-lg bg-[#003781] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
                        >
                          {syncingCampaignId === item.campaign.id
                            ? 'Sincronizzazione…'
                            : 'Sincronizza dati già caricati'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => prepareImport(item.importKind)}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-[#003781] hover:bg-slate-50"
                      >
                        Prepara caricamento {item.importLabel}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section id="import-upload" className="bg-white border border-slate-200 rounded-lg overflow-hidden scroll-mt-4">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <div className="p-2 bg-blue-50 text-[#003781] rounded-lg">
            <FileSpreadsheet size={22} />
          </div>
          <div>
            <h3 className="font-bold text-slate-800">Carica estrazione</h3>
            <p className="text-sm text-slate-500">
              Seleziona il tipo, controlla le colonne riconosciute e conferma solo dopo l’anteprima.
            </p>
          </div>
        </div>

        <div className="p-5 grid grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)] gap-6">
          <div className="space-y-4">
            <label className="block">
              <span className="text-sm font-bold text-slate-700">Tipo di caricamento</span>
              <select
                value={selectedImportKind}
                onChange={event => {
                  setSelectedImportKind(event.target.value as UploadKind | '');
                  setSelectedFiles([]);
                  setImportAnalysis(null);
                  setImportError('');
                  setImportMessage('');
                }}
                className="mt-2 w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781]"
              >
                <option value="">Seleziona il tipo…</option>
                {IMPORT_OPTIONS.map(option => (
                  <option key={option.kind} value={option.kind}>{option.title}</option>
                ))}
              </select>
            </label>

            {selectedImportKind && (
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
                {IMPORT_OPTIONS.find(option => option.kind === selectedImportKind)?.description}
              </p>
            )}

            <label className={`flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-5 text-sm font-semibold text-slate-600 ${
              selectedImportKind
                ? 'cursor-pointer hover:bg-slate-50'
                : 'opacity-50 cursor-not-allowed'
            }`}>
              <Upload size={18} />
              {selectedFiles.length > 0
                ? selectedFiles.length > 1
                  ? `${selectedFiles.length} file selezionati`
                  : selectedFiles[0].name
                : selectedImportKind === 'winback'
                  ? 'Seleziona uno o più file'
                  : 'Seleziona file Excel'}
              <input
                key={selectedImportKind}
                type="file"
                accept=".xlsx"
                multiple={selectedImportKind === 'winback'}
                disabled={!selectedImportKind}
                className="hidden"
                onChange={event => {
                  const files = Array.from(event.target.files || []);
                  if (files.length === 0) return;
                  setSelectedFiles(selectedImportKind === 'winback' ? files : files.slice(0, 1));
                  setImportAnalysis(null);
                  setImportError('');
                  setImportMessage('');
                }}
              />
            </label>

            {selectedFiles.length > 0 && (
              <div className="text-xs text-slate-500 space-y-1 max-h-28 overflow-y-auto">
                {selectedFiles.map(file => (
                  <p key={`${file.name}-${file.lastModified}`} className="truncate">{file.name}</p>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={analyzeImport}
              disabled={!selectedImportKind || selectedFiles.length === 0 || analyzingImport || importing}
              className="w-full bg-[#003781] text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {analyzingImport
                ? <Loader2 className="animate-spin" size={17} />
                : <FileSpreadsheet size={17} />}
              {analyzingImport ? 'Analisi in corso…' : 'Analizza file'}
            </button>

            {importError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg flex gap-2">
                <AlertTriangle size={17} className="shrink-0 mt-0.5" />
                <span>{importError}</span>
              </div>
            )}
            {importMessage && (
              <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg flex gap-2">
                <CheckCircle2 size={17} className="shrink-0 mt-0.5" />
                <span>{importMessage}</span>
              </div>
            )}
          </div>

          <div className="min-w-0">
            {!importAnalysis && (
              <div className="h-full min-h-56 border border-dashed border-slate-300 rounded-lg flex items-center justify-center text-center p-8">
                <div>
                  <FileSpreadsheet size={34} className="mx-auto text-slate-300" />
                  <p className="mt-3 text-sm font-bold text-slate-600">Nessun file ancora analizzato</p>
                  <p className="mt-1 text-xs text-slate-500">
                    L’analisi non modifica i dati e mostra intestazioni, righe valide e anomalie.
                  </p>
                </div>
              </div>
            )}

            {importAnalysis && (
              <div className="space-y-5">
                <div className="grid grid-cols-3 gap-3">
                  <ImportMetric label="Righe lette" value={getAnalysisRowCount(importAnalysis)} />
                  <ImportMetric label="Righe valide" value={getAnalysisValidCount(importAnalysis)} />
                  <ImportMetric label="Righe saltate" value={getAnalysisSkippedCount(importAnalysis)} />
                </div>

                {getAnalysisEntries(importAnalysis).map(entry => (
                  <div key={`${entry.fileName}-${entry.sheetName}`} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-800">{entry.fileName}</p>
                        <p className="text-xs text-slate-500">Foglio: {entry.sheetName}</p>
                      </div>
                      <span className={`self-start text-xs font-bold px-2 py-1 rounded ${
                        entry.validCount > 0
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}>
                        {entry.validCount} righe valide
                      </span>
                    </div>

                    {entry.warnings.map(warning => (
                      <div key={warning} className="mx-4 mt-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                        <AlertTriangle size={15} className="shrink-0" />
                        <span>{warning}</span>
                      </div>
                    ))}

                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-2 font-bold">Dato</th>
                            <th className="px-4 py-2 font-bold">Intestazione letta</th>
                            <th className="px-4 py-2 font-bold">Colonna</th>
                            <th className="px-4 py-2 font-bold">Metodo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {entry.columnMappings.map(mapping => (
                            <tr key={mapping.field} className="border-b border-slate-100 last:border-0">
                              <td className="px-4 py-2 font-semibold text-slate-700">{mapping.label}</td>
                              <td className="px-4 py-2 text-slate-600">
                                {mapping.detectedHeader || mapping.expectedHeader || '—'}
                              </td>
                              <td className="px-4 py-2 font-mono text-slate-700">{mapping.column || '—'}</td>
                              <td className="px-4 py-2 text-slate-500">
                                {mapping.method === 'header' ? 'Intestazione' : 'Posizione storica'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {getAnalysisPreviewRows(importAnalysis).length > 0 && (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200">
                      <p className="text-sm font-bold text-slate-800">Anteprima dati</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="text-left text-slate-500 border-b border-slate-200">
                          <tr>
                            <th className="px-4 py-2 font-bold">Cliente</th>
                            <th className="px-4 py-2 font-bold">Fonte</th>
                            <th className="px-4 py-2 font-bold">Data</th>
                            <th className="px-4 py-2 font-bold">Cellulare</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getAnalysisPreviewRows(importAnalysis).map((row, index) => (
                            <tr key={`${row.clientName}-${index}`} className="border-b border-slate-100 last:border-0">
                              <td className="px-4 py-2 font-semibold text-slate-700">{row.clientName || '—'}</td>
                              <td className="px-4 py-2 text-slate-600">{row.source || '—'}</td>
                              <td className="px-4 py-2 text-slate-600">{formatDateForDisplay(row.date) || '—'}</td>
                              <td className="px-4 py-2 text-slate-600">{row.phone || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {hasInvalidAnalysis(importAnalysis) && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-3 rounded-lg flex gap-2">
                    <AlertTriangle size={17} className="shrink-0" />
                    <span>Importazione bloccata: almeno un file non contiene righe valide per il tipo selezionato.</span>
                  </div>
                )}

                <button
                  type="button"
                  onClick={confirmImport}
                  disabled={importing || hasInvalidAnalysis(importAnalysis)}
                  className="w-full bg-emerald-600 text-white rounded-lg py-3 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {importing
                    ? <Loader2 className="animate-spin" size={17} />
                    : <CheckCircle2 size={17} />}
                  {importing ? 'Importazione in corso…' : 'Conferma e importa'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

type AnalysisEntry = {
  fileName: string;
  sheetName: string;
  validCount: number;
  columnMappings: ImportColumnMapping[];
  warnings: string[];
};

type AnalysisPreviewRow = {
  clientName: string;
  source: string;
  date: string;
  phone: string;
};

function ImportMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-800">{value}</p>
    </div>
  );
}

function getAnalysisEntries(analysis: ImportAnalysis): AnalysisEntry[] {
  if (analysis.kind === 'customerClusters') {
    return [{
      fileName: analysis.parsed.fileName,
      sheetName: analysis.parsed.sheetName,
      validCount: analysis.parsed.records.length,
      columnMappings: analysis.parsed.columnMappings || [],
      warnings: analysis.parsed.mappingWarnings || [],
    }];
  }

  return analysis.parsed.map(parsed => ({
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    validCount: getParsedValidCount(parsed),
    columnMappings: parsed.columnMappings || [],
    warnings: parsed.mappingWarnings || [],
  }));
}

function getAnalysisRowCount(analysis: ImportAnalysis): number {
  return analysis.kind === 'customerClusters'
    ? analysis.parsed.rowCount
    : analysis.parsed.reduce((total, parsed) => total + parsed.rowCount, 0);
}

function getAnalysisValidCount(analysis: ImportAnalysis): number {
  return analysis.kind === 'customerClusters'
    ? analysis.parsed.records.length
    : analysis.parsed.reduce(
        (total, parsed) => total + getParsedValidCount(parsed),
        0,
      );
}

function getAnalysisSkippedCount(analysis: ImportAnalysis): number {
  return analysis.kind === 'customerClusters'
    ? analysis.parsed.skippedRows
    : analysis.parsed.reduce((total, parsed) => total + parsed.skippedRows, 0);
}

function hasInvalidAnalysis(analysis: ImportAnalysis): boolean {
  return getAnalysisEntries(analysis).some(entry => entry.validCount === 0);
}

function getParsedValidCount(parsed: ParsedImport): number {
  if (parsed.kind === 'newClients') return parsed.newClients?.length || 0;
  if (parsed.kind === 'expirations') return parsed.expirationRecords?.length || 0;
  return parsed.tasks.length;
}

function getAnalysisPreviewRows(analysis: ImportAnalysis): AnalysisPreviewRow[] {
  if (analysis.kind === 'customerClusters') {
    return analysis.parsed.records.slice(0, 5).map(record => ({
      clientName: record.clientName,
      source: record.sourceName,
      date: record.quietanzaDate,
      phone: record.phone,
    }));
  }

  return analysis.parsed.flatMap(parsed => {
    if (parsed.kind === 'newClients') {
      return (parsed.newClients || []).slice(0, 5).map(record => ({
        clientName: record.clientName,
        source: record.sourceName,
        date: record.relationshipStartDate,
        phone: record.phone,
      }));
    }

    if (parsed.kind === 'expirations') {
      return (parsed.expirationRecords || []).slice(0, 5).map(record => ({
        clientName: record.clientName,
        source: record.sourceName,
        date: record.eventDate,
        phone: record.phone,
      }));
    }

    return parsed.tasks.slice(0, 5).map(task => ({
      clientName: task.clientName,
      source: task.sourceName,
      date: task.exitDate || task.eventDate,
      phone: task.phone,
    }));
  }).slice(0, 5);
}

function getCoveragePresentation(daysRemaining: number | null): {
  label: string;
  cardClass: string;
  badgeClass: string;
  messageClass: string;
} {
  if (daysRemaining === null) {
    return {
      label: 'Da caricare',
      cardClass: 'border-red-200 bg-red-50/50',
      badgeClass: 'bg-red-100 text-red-700',
      messageClass: 'text-red-700',
    };
  }
  if (daysRemaining < 0) {
    return {
      label: 'Scoperta',
      cardClass: 'border-red-200 bg-red-50/50',
      badgeClass: 'bg-red-100 text-red-700',
      messageClass: 'text-red-700',
    };
  }
  if (daysRemaining <= 7) {
    return {
      label: 'Urgente',
      cardClass: 'border-red-200 bg-red-50/50',
      badgeClass: 'bg-red-100 text-red-700',
      messageClass: 'text-red-700',
    };
  }
  if (daysRemaining <= 30) {
    return {
      label: 'Da pianificare',
      cardClass: 'border-amber-200 bg-amber-50/50',
      badgeClass: 'bg-amber-100 text-amber-700',
      messageClass: 'text-amber-700',
    };
  }
  return {
    label: 'Coperta',
    cardClass: 'border-emerald-200 bg-emerald-50/40',
    badgeClass: 'bg-emerald-100 text-emerald-700',
    messageClass: 'text-emerald-700',
  };
}

function describeCoverageDeadline(daysRemaining: number | null): string {
  if (daysRemaining === null) return 'Carica i dati ora per attivare la copertura.';
  if (daysRemaining < 0) {
    const elapsedDays = Math.abs(daysRemaining);
    return `Copertura terminata ${elapsedDays === 1 ? '1 giorno fa' : `${elapsedDays} giorni fa`}.`;
  }
  if (daysRemaining === 0) return 'Per non restare scoperto, carica i dati oggi.';
  if (daysRemaining === 1) return 'Per non restare scoperto, carica entro 1 giorno.';
  return `Per non restare scoperto, carica entro ${daysRemaining} giorni.`;
}

function formatDateForDisplay(value: string): string {
  if (!value || !value.match(/^\d{4}-\d{2}-\d{2}$/)) return value;
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
