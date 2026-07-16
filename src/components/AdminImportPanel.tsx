import React, { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import {
  CalendarPlus,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { db } from '../firebase';
import {
  Campaign,
  ImportKind,
  importCallTasks,
  parseClientWorkbook,
  syncCampaignTasks,
} from '../callCenter';
import { isCallCategoryEnabled } from '../callWorkflowConfig';
import { CLIENT_IMPORT_CONFIG } from '../clientImportConfig';

type CampaignDraft = {
  id?: string;
  name: string;
  description: string;
  monthsAfterStart: string;
  active: boolean;
};

const EMPTY_CAMPAIGN: CampaignDraft = {
  name: '',
  description: '',
  monthsAfterStart: '3',
  active: true,
};

const IMPORT_CARDS: Array<{
  kind: ImportKind;
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
    title: 'Scadenze annuali',
    description: 'Campagna annuali dal 01/09/2026: richiamo 45 giorni prima della scadenza.',
  },
  {
    kind: 'winback',
    title: 'Winback',
    description: 'Importa uno o più mesi e calcola il richiamo 10 giorni prima dell’anniversario.',
  },
];

const VISIBLE_IMPORT_CARDS = IMPORT_CARDS.filter(card =>
  card.kind !== 'expirations' ||
  isCallCategoryEnabled('scadenza_rata') ||
  isCallCategoryEnabled('scadenza_annuale')
);

export default function AdminImportPanel() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft>(EMPTY_CAMPAIGN);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [campaignError, setCampaignError] = useState('');
  const [campaignMessage, setCampaignMessage] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<Partial<Record<ImportKind, File[]>>>({});
  const [importingKind, setImportingKind] = useState<ImportKind | null>(null);
  const [importMessages, setImportMessages] = useState<Partial<Record<ImportKind, string>>>({});

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

  const saveCampaign = async (event: React.FormEvent) => {
    event.preventDefault();
    setCampaignError('');
    setCampaignMessage('');

    const monthsAfterStart = Number(campaignDraft.monthsAfterStart);
    if (!campaignDraft.name.trim() || !Number.isInteger(monthsAfterStart) || monthsAfterStart < 1) {
      setCampaignError('Inserisci un nome e un numero di mesi maggiore di zero.');
      return;
    }

    const activeWithoutCurrent = campaigns.filter(
      campaign => campaign.active && campaign.id !== campaignDraft.id
    ).length;
    if (campaignDraft.active && activeWithoutCurrent >= 3) {
      setCampaignError('Possono esserci al massimo tre campagne attive.');
      return;
    }

    setSavingCampaign(true);
    try {
      const payload = {
        name: campaignDraft.name.trim(),
        description: campaignDraft.description.trim(),
        monthsAfterStart,
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

      const result = await syncCampaignTasks({
        id: campaignId,
        ...payload,
      });
      setCampaignMessage(
        campaignDraft.active
          ? result.totalRows > 0
            ? `Campagna salvata: ${result.created} chiamate create, ${result.updated} aggiornate e ${result.unchanged} già presenti.`
            : 'Campagna salvata. Importa il file Nuovi clienti per generare le chiamate.'
          : 'Campagna salvata come disattivata.'
      );
      setCampaignDraft(EMPTY_CAMPAIGN);
    } catch (error) {
      console.error('Error saving campaign:', error);
      setCampaignError('Non è stato possibile salvare la campagna.');
    } finally {
      setSavingCampaign(false);
    }
  };

  const editCampaign = (campaign: Campaign) => {
    setCampaignDraft({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      monthsAfterStart: String(campaign.monthsAfterStart),
      active: campaign.active,
    });
  };

  const removeCampaign = async (campaign: Campaign) => {
    if (!window.confirm(`Eliminare la campagna "${campaign.name}"?`)) return;
    await deleteDoc(doc(db, 'campaigns', campaign.id));
    if (campaignDraft.id === campaign.id) setCampaignDraft(EMPTY_CAMPAIGN);
  };

  const runImport = async (kind: ImportKind) => {
    const files = selectedFiles[kind] || [];
    if (files.length === 0) return;

    setImportingKind(kind);
    setImportMessages(previous => ({ ...previous, [kind]: '' }));

    try {
      const totals = {
        created: 0,
        updated: 0,
        unchanged: 0,
        skippedRows: 0,
        storedClients: 0,
      };
      const fileSummaries: string[] = [];

      for (const file of files) {
        const parsed = await parseClientWorkbook(file, kind, campaigns);
        const result = await importCallTasks(parsed);
        totals.created += result.created;
        totals.updated += result.updated;
        totals.unchanged += result.unchanged;
        totals.skippedRows += result.skippedRows;
        totals.storedClients += result.storedClients;
        fileSummaries.push(`${file.name}: ${result.created} nuove, ${result.updated} aggiornate, ${result.unchanged} invariate`);
      }

      setImportMessages(previous => ({
        ...previous,
        [kind]: [
          `${totals.created} nuove`,
          `${totals.updated} aggiornate`,
          `${totals.unchanged} invariate`,
          ...(kind === 'newClients'
            ? [`${totals.storedClients} clienti memorizzati o aggiornati`]
            : []),
          `${totals.skippedRows} righe saltate`,
          ...(files.length > 1 ? [`File: ${fileSummaries.join(' · ')}`] : []),
        ].join(' · '),
      }));
    } catch (error) {
      console.error('Import error:', error);
      setImportMessages(previous => ({
        ...previous,
        [kind]: error instanceof Error
          ? error.message
          : 'Importazione non riuscita.',
      }));
    } finally {
      setImportingKind(null);
    }
  };

  return (
    <div className="space-y-8">
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center gap-3">
          <CalendarPlus className="text-[#003781]" size={22} />
          <div>
            <h3 className="font-bold text-slate-800">Campagne nuovi clienti</h3>
            <p className="text-sm text-slate-500">
              Massimo tre campagne attive. Attualmente: {activeCampaigns.length}/3.
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
                  </div>
                  <p className="text-sm text-slate-500 mt-1">{campaign.description || 'Nessuna descrizione'}</p>
                  <p className="text-xs font-semibold text-[#003781] mt-2">
                    Dopo {campaign.monthsAfterStart} mesi dall’ingresso
                  </p>
                </div>
                <div className="flex gap-1 shrink-0">
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

      <section>
        <div className="mb-4">
          <h3 className="font-bold text-slate-800">Importazione Excel</h3>
          <p className="text-sm text-slate-500">
            I nuovi clienti restano memorizzati: le campagne create in seguito
            generano automaticamente le relative chiamate. Il Winback accetta
            più file mensili e li mantiene cumulativi.
          </p>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {VISIBLE_IMPORT_CARDS.map(card => {
            const config = CLIENT_IMPORT_CONFIG[card.kind];
            const files = selectedFiles[card.kind] || [];
            const isImporting = importingKind === card.kind;
            const allowsMultipleFiles = card.kind === 'winback';

            return (
              <div key={card.kind} className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-blue-50 text-[#003781] rounded-lg">
                    <FileSpreadsheet size={22} />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-800">{card.title}</h4>
                    <p className="text-xs text-slate-500 mt-1">{card.description}</p>
                  </div>
                </div>

                <div className="mt-5 text-xs text-slate-500 space-y-1">
                  <p><strong>File:</strong> {config.fileName}</p>
                  <p>
                    <strong>Scheda:</strong>{' '}
                    {card.kind === 'winback'
                      ? `${config.sheetName} o primo foglio disponibile`
                      : config.sheetName}
                  </p>
                </div>

                <label className="mt-5 flex items-center justify-center gap-2 border border-dashed border-slate-300 rounded-lg px-3 py-4 text-sm font-semibold text-slate-600 cursor-pointer hover:bg-slate-50">
                  <Upload size={18} />
                  {files.length > 0
                    ? allowsMultipleFiles
                      ? `${files.length} file selezionati`
                      : files[0].name
                    : allowsMultipleFiles
                      ? 'Seleziona uno o più file'
                      : 'Seleziona file'}
                  <input
                    type="file"
                    accept=".xlsx"
                    multiple={allowsMultipleFiles}
                    className="hidden"
                    onChange={event => {
                      const selected = Array.from(event.target.files || []);
                      if (selected.length === 0) return;
                      setSelectedFiles(previous => ({ ...previous, [card.kind]: selected }));
                      setImportMessages(previous => ({ ...previous, [card.kind]: '' }));
                    }}
                  />
                </label>

                {allowsMultipleFiles && files.length > 0 && (
                  <div className="mt-2 text-xs text-slate-500 space-y-1 max-h-24 overflow-y-auto">
                    {files.map(file => (
                      <p key={`${file.name}-${file.lastModified}`} className="truncate">
                        {file.name}
                      </p>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => runImport(card.kind)}
                  disabled={files.length === 0 || isImporting || importingKind !== null}
                  className="mt-3 w-full bg-[#003781] text-white rounded-lg py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
                >
                  {isImporting ? <Loader2 className="animate-spin" size={17} /> : <Upload size={17} />}
                  {isImporting ? 'Importazione...' : 'Importa'}
                </button>

                {importMessages[card.kind] && (
                  <div className="mt-3 text-xs text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-lg flex gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                    <span>{importMessages[card.kind]}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
