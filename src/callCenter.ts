import {
  addDays,
  addMonths,
  addYears,
  format,
  isValid,
  parse,
  parseISO,
  subDays,
} from 'date-fns';
import {
  addDoc,
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  doc,
} from 'firebase/firestore';
import { db } from './firebase';
import { getItalyDate } from './lib/utils';
import {
  AUTHORIZED_EMPLOYEES,
} from './constants';
import { CLIENT_IMPORT_CONFIG } from './clientImportConfig';
import { CallStatusId } from './callWorkflowConfig';
import {
  ImportColumnMapping,
  NEW_CLIENT_HEADER_COLUMNS,
  WIDE_EXPIRATION_HEADER_COLUMNS,
  describeLegacyColumns,
  resolveExactHeaderColumns,
} from './importColumnResolver';
import { SOURCE_DIRECTORY } from './sourceDirectory';

export type ImportKind = 'newClients' | 'expirations' | 'winback';
export type CallCategory =
  | 'campagna'
  | 'scadenza_rata'
  | 'scadenza_annuale'
  | 'winback';

export type CampaignKind = 'newClients' | 'annualExpirations';

export type Campaign = {
  id: string;
  name: string;
  description: string;
  campaignKind?: CampaignKind;
  monthsAfterStart?: number;
  daysBeforeExpiration?: number;
  startDate?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type CallTask = {
  id: string;
  importType: ImportKind;
  category: CallCategory;
  categoryLabel: string;
  campaignId?: string;
  campaignName?: string;
  clientName: string;
  phone: string;
  sourceCode: string;
  sourceName: string;
  sourceOwnerEmail: string;
  sourceOwnerName: string;
  policyNumber: string;
  policyType: string;
  fiscalCode: string;
  expirationType: string;
  vehiclePlate: string;
  autoPremium: string;
  coverages: string;
  birthDate: string;
  relationshipStartDate: string;
  exitDate: string;
  lastGrossPremium: string;
  eventDate: string;
  dueDate: string;
  status: CallStatusId;
  calledDate?: string;
  callbackDate?: string;
  assignedToUid?: string;
  assignedToEmail?: string;
  assignedToName?: string;
  updatedByUid?: string;
  updatedByName?: string;
  updatedAt?: unknown;
  createdAt?: unknown;
  importedAt?: unknown;
  sourceFingerprint: string;
};

export type NewClientRecord = {
  id: string;
  clientName: string;
  fiscalCode: string;
  phone: string;
  sourceCode: string;
  sourceName: string;
  sourceOwnerEmail: string;
  sourceOwnerName: string;
  coverages: string;
  birthDate: string;
  relationshipStartDate: string;
  dedupeKey: string;
  fallbackDedupeKey: string;
  sourceFingerprint: string;
  importedAt?: unknown;
  createdAt?: unknown;
};

export type ExpirationRecord = {
  id: string;
  clientName: string;
  phone: string;
  sourceCode: string;
  sourceName: string;
  sourceOwnerEmail: string;
  sourceOwnerName: string;
  policyNumber: string;
  policyType: string;
  fiscalCode: string;
  expirationType: string;
  vehiclePlate: string;
  autoPremium: string;
  eventDate: string;
  sourceFingerprint: string;
  importedAt?: unknown;
  createdAt?: unknown;
};

export type ParsedImport = {
  kind: ImportKind;
  fileName: string;
  sheetName: string;
  rowCount: number;
  skippedRows: number;
  duplicateRows?: number;
  tasks: Array<Omit<CallTask, 'status' | 'id'> & { id: string }>;
  columnMappings?: ImportColumnMapping[];
  mappingWarnings?: string[];
  newClients?: NewClientRecord[];
  expirationRecords?: ExpirationRecord[];
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  excludedRecoveredWinback: number;
  skippedRows: number;
  totalRows: number;
  generatedTasks: number;
  storedClients: number;
  storedExpirations: number;
};

type WorksheetLike = {
  rowCount: number;
  columnCount?: number;
  actualColumnCount?: number;
  getCell(row: number, column: number): {
    value: unknown;
    text: string;
  };
};

type NewClientColumns = Record<
  typeof NEW_CLIENT_HEADER_COLUMNS[number]['field'],
  string
>;
type ExpirationColumns = Record<
  keyof typeof CLIENT_IMPORT_CONFIG.expirations.columns,
  string
>;
type WinbackColumns = Record<
  keyof typeof CLIENT_IMPORT_CONFIG.winback.columns,
  string
>;
type ColumnResolution<T extends Record<string, string>> = {
  columns: T;
  mappings: ImportColumnMapping[];
  missingRequiredHeaders: string[];
  mode: 'header' | 'legacy';
  warnings: string[];
};

const EXPIRATION_COLUMN_LABELS: Record<keyof ExpirationColumns, string> = {
  fullName: 'Nome e cognome',
  policyNumber: 'Numero polizza',
  source: 'Fonte',
  policyType: 'Ramo / tipologia polizza',
  fiscalCode: 'Codice fiscale / P.IVA',
  expirationType: 'Tipo scadenza',
  nextExpirationDate: 'Prossima scadenza',
  vehiclePlate: 'Targa',
  phone: 'Cellulare',
  autoPremium: 'Premio auto annuale',
};

const WINBACK_COLUMN_LABELS: Record<keyof WinbackColumns, string> = {
  fullName: 'Nome e cognome',
  policyNumber: 'Numero polizza',
  source: 'Fonte',
  lastGrossPremium: 'Ultimo premio lordo',
  premiumFrequency: 'Frequenza premio (Fr.)',
  exitDate: 'Data uscita',
  vehiclePlate: 'Targa',
  phone: 'Cellulare',
};

const DATE_FORMAT = 'yyyy-MM-dd';
export const CALL_TRACKING_START_DATE = '2026-06-19';

export async function parseClientWorkbook(
  file: File,
  kind: ImportKind,
  campaigns: Campaign[],
): Promise<ParsedImport> {
  const ExcelJS = await import('exceljs');
  const Workbook = ExcelJS.Workbook || ExcelJS.default.Workbook;
  const workbook = new Workbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer as never);

  const config = CLIENT_IMPORT_CONFIG[kind];
  const requestedSheetName = config.sheetName;
  const worksheet = workbook.getWorksheet(requestedSheetName) || workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('Nessun foglio leggibile trovato nel file.');
  }

  const newClientResolution = kind === 'newClients'
    ? resolveExactHeaderColumns(
        worksheet as WorksheetLike,
        NEW_CLIENT_HEADER_COLUMNS,
      )
    : undefined;
  if (newClientResolution?.missingRequiredHeaders.length) {
    throw new Error(
      `Il file non corrisponde a Nuovi clienti. Intestazioni mancanti: ${newClientResolution.missingRequiredHeaders.join(', ')}.`
    );
  }

  const expirationResolution = kind === 'expirations'
    ? getExpirationColumnResolution(worksheet as WorksheetLike)
    : undefined;
  const winbackResolution = kind === 'winback'
    ? getWinbackColumnResolution(worksheet as WorksheetLike)
    : undefined;
  const columnResolution = newClientResolution || expirationResolution || winbackResolution;

  const tasks: ParsedImport['tasks'] = [];
  const newClients: NewClientRecord[] = [];
  const expirationRecords: ExpirationRecord[] = [];
  const activeCampaigns = campaigns.filter(item => item.active);
  const activeNewClientCampaigns = activeCampaigns.filter(isNewClientCampaign);
  const activeAnnualExpirationCampaigns = activeCampaigns.filter(isAnnualExpirationCampaign);
  let skippedRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    if (kind === 'newClients') {
      const client = buildNewClientRecord(
        worksheet as WorksheetLike,
        rowNumber,
        newClientResolution!.columns,
      );

      if (!client) {
        skippedRows += 1;
        continue;
      }

      newClients.push(client);
      continue;
    }

    if (kind === 'expirations') {
      const expirationRecord = buildAnnualExpirationRecord(
        worksheet as WorksheetLike,
        rowNumber,
        expirationResolution!.columns,
      );

      if (!expirationRecord) {
        skippedRows += 1;
        continue;
      }

      expirationRecords.push(expirationRecord);
      tasks.push(...buildAnnualExpirationCampaignTasks(
        expirationRecord,
        activeAnnualExpirationCampaigns,
      ));
      continue;
    }

    const generated = buildTasksForRow(
      worksheet as WorksheetLike,
      rowNumber,
      winbackResolution!.columns,
    );

    if (generated.length === 0) {
      skippedRows += 1;
      continue;
    }

    tasks.push(...generated);
  }

  const deduplicatedNewClients = kind === 'newClients'
    ? dedupeNewClientRecords(newClients)
    : { records: newClients, duplicateRows: 0 };
  if (kind === 'newClients') {
    tasks.push(...deduplicatedNewClients.records.flatMap(client =>
      buildCampaignTasksForClient(client, activeNewClientCampaigns)
    ));
  }

  return {
    kind,
    fileName: file.name,
    sheetName: worksheet.name || requestedSheetName,
    rowCount: Math.max(0, worksheet.rowCount - 1),
    skippedRows,
    duplicateRows: deduplicatedNewClients.duplicateRows,
    tasks,
    columnMappings: columnResolution?.mappings,
    mappingWarnings: columnResolution?.warnings,
    ...(kind === 'newClients' ? { newClients: deduplicatedNewClients.records } : {}),
    ...(kind === 'expirations' ? { expirationRecords } : {}),
  };
}

export async function importCallTasks(parsed: ParsedImport): Promise<ImportResult> {
  const validRecordCount = parsed.kind === 'newClients'
    ? parsed.newClients?.length ?? parsed.tasks.length
    : parsed.kind === 'expirations'
      ? parsed.expirationRecords?.length ?? parsed.tasks.length
      : parsed.tasks.length;
  if (parsed.rowCount > 0 && validRecordCount === 0) {
    throw new Error(
      'Importazione bloccata: il file non contiene righe valide per il tipo selezionato.'
    );
  }

  const storedClients = parsed.newClients
    ? await importNewClientRecords(parsed.newClients)
    : 0;
  const storedExpirations = parsed.expirationRecords
    ? await importExpirationRecords(parsed.expirationRecords)
    : 0;
  const existingSnapshot = await getDocs(
    query(collection(db, 'call_tasks'), where('importType', '==', parsed.kind))
  );
  const existingById = new Map(
    existingSnapshot.docs.map(item => [
      item.id,
      {
        id: item.id,
        fingerprint: item.data().sourceFingerprint as string | undefined,
        task: item.data() as Partial<CallTask>,
      },
    ])
  );
  const existingByLogicalKey = new Map(
    existingSnapshot.docs.map(item => [
      getTaskLogicalKey(item.data() as Partial<CallTask>),
      {
        id: item.id,
        fingerprint: item.data().sourceFingerprint as string | undefined,
        task: item.data() as Partial<CallTask>,
      },
    ])
  );
  const recoveredWinbackEvents = new Map<string, string>();
  if (parsed.kind === 'winback') {
    for (const item of existingSnapshot.docs) {
      const task = item.data() as Partial<CallTask>;
      if (task.status !== 'ripreso') continue;

      const relationshipKey = getWinbackRelationshipKey(task);
      const previousEventDate = recoveredWinbackEvents.get(relationshipKey);
      if (!previousEventDate || (task.eventDate || '') < previousEventDate) {
        recoveredWinbackEvents.set(relationshipKey, task.eventDate || '');
      }
    }
  }
  const shouldPruneOpenTasks = parsed.kind === 'expirations';
  const nextTaskIds = shouldPruneOpenTasks
    ? new Set(parsed.tasks.map(task => task.id))
    : undefined;
  const nextTaskLogicalKeys = shouldPruneOpenTasks
    ? new Set(parsed.tasks.map(task => getTaskLogicalKey(task)))
    : undefined;

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let excludedRecoveredWinback = 0;
  let excludedParsedWinback = 0;
  let batch = writeBatch(db);
  let batchSize = 0;
  const removedRecoveredTaskIds = new Set<string>();

  const commitBatch = async () => {
    if (batchSize === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchSize = 0;
  };

  if (shouldPruneOpenTasks && nextTaskIds && nextTaskLogicalKeys) {
    for (const item of existingSnapshot.docs) {
      const task = item.data() as Partial<CallTask>;
      const isStillGenerated = nextTaskIds.has(item.id) ||
        nextTaskLogicalKeys.has(getTaskLogicalKey(task));
      if (isStillGenerated || task.status !== 'da_chiamare') continue;

      batch.delete(doc(db, 'call_tasks', item.id));
      batchSize += 1;
      if (batchSize >= 400) await commitBatch();
    }
  }

  if (parsed.kind === 'winback') {
    for (const item of existingSnapshot.docs) {
      const task = item.data() as Partial<CallTask>;
      const recoveredEventDate = recoveredWinbackEvents.get(
        getWinbackRelationshipKey(task),
      );
      if (
        task.status !== 'da_chiamare' ||
        !recoveredEventDate ||
        !task.eventDate ||
        task.eventDate <= recoveredEventDate
      ) continue;

      batch.delete(doc(db, 'call_tasks', item.id));
      batchSize += 1;
      excludedRecoveredWinback += 1;
      removedRecoveredTaskIds.add(item.id);
      if (batchSize >= 400) await commitBatch();
    }
  }

  for (const task of parsed.tasks) {
    const existingTask = existingById.get(task.id) ||
      existingByLogicalKey.get(getTaskLogicalKey(task));
    const recoveredEventDate = task.importType === 'winback'
      ? recoveredWinbackEvents.get(getWinbackRelationshipKey(task))
      : undefined;
    if (recoveredEventDate && task.eventDate > recoveredEventDate) {
      excludedParsedWinback += 1;
      if (!existingTask || !removedRecoveredTaskIds.has(existingTask.id)) {
        excludedRecoveredWinback += 1;
      }
      continue;
    }

    // Una chiamata gia' lavorata conserva integralmente date e contenuti del
    // proprio ciclo. I ricaricamenti possono aggiornare soltanto le chiamate
    // ancora in stato "Da chiamare".
    if (
      task.importType === 'winback' &&
      existingTask &&
      existingTask.task.status !== 'da_chiamare'
    ) {
      unchanged += 1;
      continue;
    }

    const previousFingerprint = existingTask?.fingerprint;

    if (previousFingerprint === task.sourceFingerprint) {
      unchanged += 1;
      continue;
    }

    const taskRef = doc(db, 'call_tasks', existingTask?.id || task.id);
    const storedTask = removeUndefined({
      ...task,
      importedAt: serverTimestamp(),
      ...(previousFingerprint === undefined
        ? {
            status: 'da_chiamare' as CallStatusId,
            createdAt: serverTimestamp(),
          }
        : {}),
    });

    batch.set(taskRef, storedTask, { merge: true });
    batchSize += 1;

    if (previousFingerprint === undefined) created += 1;
    else updated += 1;

    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();

  const result: ImportResult = {
    created,
    updated,
    unchanged,
    excludedRecoveredWinback,
    skippedRows: parsed.skippedRows,
    totalRows: parsed.rowCount,
    generatedTasks: parsed.tasks.length - excludedParsedWinback,
    storedClients,
    storedExpirations,
  };

  await addDoc(collection(db, 'import_runs'), {
    importType: parsed.kind,
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    ...result,
    duplicateRows: parsed.duplicateRows || 0,
    importedAt: serverTimestamp(),
  });

  return result;
}

export async function syncCampaignTasks(
  campaign: Campaign,
): Promise<ImportResult> {
  if (!campaign.active) {
    return {
      created: 0,
      updated: 0,
      unchanged: 0,
      excludedRecoveredWinback: 0,
      skippedRows: 0,
      totalRows: 0,
      generatedTasks: 0,
      storedClients: 0,
      storedExpirations: 0,
    };
  }

  if (isAnnualExpirationCampaign(campaign)) {
    const expirationRecords = await loadStoredAnnualExpirationRecords();
    const tasks = expirationRecords.flatMap(record =>
      buildAnnualExpirationCampaignTasks(record, [campaign])
    );
    await pruneOpenCampaignTasks(campaign.id, tasks);
    if (tasks.length === 0) {
      return createEmptyImportResult(expirationRecords.length);
    }

    return importCallTasks({
      kind: 'expirations',
      fileName: 'Scadenze clienti memorizzate',
      sheetName: CLIENT_IMPORT_CONFIG.expirations.sheetName,
      rowCount: expirationRecords.length,
      skippedRows: 0,
      tasks,
    });
  }

  const clientsSnapshot = await getDocs(collection(db, 'new_clients'));
  const clients = clientsSnapshot.docs.map(item => ({
    id: item.id,
    ...item.data(),
  } as NewClientRecord));
  const deduplicatedClients = dedupeNewClientRecords(clients).records;

  const tasks = deduplicatedClients.flatMap(client =>
    buildCampaignTasksForClient(client, [campaign])
  );
  await pruneOpenCampaignTasks(campaign.id, tasks);
  if (tasks.length === 0) {
    return createEmptyImportResult(clients.length);
  }

  return importCallTasks({
    kind: 'newClients',
    fileName: 'Clienti memorizzati',
    sheetName: CLIENT_IMPORT_CONFIG.newClients.sheetName,
    rowCount: deduplicatedClients.length,
    skippedRows: 0,
    tasks,
  });
}

function createEmptyImportResult(totalRows: number): ImportResult {
  return {
    created: 0,
    updated: 0,
    unchanged: 0,
    excludedRecoveredWinback: 0,
    skippedRows: 0,
    totalRows,
    generatedTasks: 0,
    storedClients: 0,
    storedExpirations: 0,
  };
}

async function pruneOpenCampaignTasks(
  campaignId: string | undefined,
  nextTasks: ParsedImport['tasks'],
): Promise<void> {
  if (!campaignId) return;

  const nextIds = new Set(nextTasks.map(task => task.id));
  const nextLogicalKeys = new Set(nextTasks.map(task => getTaskLogicalKey(task)));
  const existingSnapshot = await getDocs(
    query(collection(db, 'call_tasks'), where('campaignId', '==', campaignId))
  );
  let batch = writeBatch(db);
  let batchSize = 0;

  const commitBatch = async () => {
    if (batchSize === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchSize = 0;
  };

  for (const item of existingSnapshot.docs) {
    const task = item.data() as Partial<CallTask>;
    const isStillGenerated = nextIds.has(item.id) ||
      nextLogicalKeys.has(getTaskLogicalKey(task));
    if (isStillGenerated || task.status !== 'da_chiamare') continue;

    batch.delete(doc(db, 'call_tasks', item.id));
    batchSize += 1;
    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();
}

async function importNewClientRecords(
  clients: NewClientRecord[],
): Promise<number> {
  const existingSnapshot = await getDocs(collection(db, 'new_clients'));
  const existingClients = existingSnapshot.docs.map(item => ({
    id: item.id,
    record: {
      id: item.id,
      ...item.data(),
    } as NewClientRecord,
  }));

  let storedClients = 0;
  let batch = writeBatch(db);
  let batchSize = 0;

  const commitBatch = async () => {
    if (batchSize === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchSize = 0;
  };

  for (const client of clients) {
    const existingClient = existingClients.find(item =>
      areSameNewClient(item.record, client)
    );
    const targetId = existingClient?.id || client.id;
    const storedClient = {
      ...client,
      id: targetId,
    };
    const previousFingerprint = existingClient?.record.sourceFingerprint;
    if (previousFingerprint === client.sourceFingerprint) continue;

    batch.set(doc(db, 'new_clients', targetId), {
      ...storedClient,
      importedAt: serverTimestamp(),
      ...(existingClient === undefined
        ? { createdAt: serverTimestamp() }
        : {}),
    }, { merge: true });
    batchSize += 1;
    storedClients += 1;

    if (existingClient) existingClient.record = storedClient;
    else existingClients.push({ id: targetId, record: storedClient });

    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();
  return storedClients;
}

async function importExpirationRecords(
  expirations: ExpirationRecord[],
): Promise<number> {
  const existingSnapshot = await getDocs(collection(db, 'expiration_records'));
  const nextIds = new Set(expirations.map(expiration => expiration.id));
  const existingById = new Map(
    existingSnapshot.docs.map(item => [
      item.id,
      item.data().sourceFingerprint as string | undefined,
    ])
  );

  let storedExpirations = 0;
  let batch = writeBatch(db);
  let batchSize = 0;

  const commitBatch = async () => {
    if (batchSize === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchSize = 0;
  };

  for (const item of existingSnapshot.docs) {
    if (nextIds.has(item.id)) continue;

    batch.delete(doc(db, 'expiration_records', item.id));
    batchSize += 1;
    if (batchSize >= 400) await commitBatch();
  }

  for (const expiration of expirations) {
    const previousFingerprint = existingById.get(expiration.id);
    if (previousFingerprint === expiration.sourceFingerprint) continue;

    batch.set(doc(db, 'expiration_records', expiration.id), {
      ...expiration,
      importedAt: serverTimestamp(),
      ...(previousFingerprint === undefined
        ? { createdAt: serverTimestamp() }
        : {}),
    }, { merge: true });
    batchSize += 1;
    storedExpirations += 1;

    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();
  return storedExpirations;
}

async function loadStoredAnnualExpirationRecords(): Promise<ExpirationRecord[]> {
  const snapshot = await getDocs(collection(db, 'expiration_records'));
  const records = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data(),
  } as ExpirationRecord));

  if (records.length > 0) return records;

  const fallbackSnapshot = await getDocs(
    query(collection(db, 'call_tasks'), where('category', '==', 'scadenza_annuale'))
  );

  return fallbackSnapshot.docs.map(item => annualExpirationRecordFromTask(
    item.id,
    item.data() as CallTask,
  )).filter((record): record is ExpirationRecord => Boolean(record));
}

function getTaskLogicalKey(task: Partial<CallTask>): string {
  if (task.importType === 'expirations') {
    const expirationIdentity = getExpirationTaskIdentity(task);

    if (task.category === 'campagna') {
      return [
        task.importType,
        task.campaignId,
        expirationIdentity,
        task.expirationType,
        task.eventDate,
      ].join('|');
    }

    return [
      task.importType,
      expirationIdentity,
      task.expirationType,
      task.eventDate,
    ].join('|');
  }

  if (task.importType === 'winback') {
    return [
      task.importType,
      task.policyNumber,
      task.exitDate,
      task.eventDate,
    ].join('|');
  }

  return [
    task.importType,
    task.campaignId,
    getNewClientFallbackDedupeKey({
      clientName: task.clientName || '',
      birthDate: task.birthDate || '',
      sourceCode: task.sourceCode || '',
    }),
  ].join('|');
}

function getWinbackRelationshipKey(task: Partial<CallTask>): string {
  return [
    task.policyNumber || '',
    task.exitDate || '',
  ].join('|');
}

export function adjustWeekendToMonday(date: Date): Date {
  const day = date.getDay();
  if (day === 6) return addDays(date, 2);
  if (day === 0) return addDays(date, 1);
  return date;
}

export function getTaskEffectiveDate(task: CallTask): string {
  return task.status === 'da_richiamare' && task.callbackDate
    ? task.callbackDate
    : task.dueDate;
}

export function getTaskCategoryLabel(task: CallTask): string {
  if (task.category !== 'winback') return task.categoryLabel;

  const exitYear = Number(task.exitDate?.slice(0, 4));
  const eventYear = Number(task.eventDate?.slice(0, 4));
  const yearsSinceExit = eventYear - exitYear;

  if (yearsSinceExit === 1) return 'Winback · Uscito 1 anno fa';
  if (yearsSinceExit === 2) return 'Winback · Uscito 2 anni fa';
  return task.categoryLabel || 'Winback';
}

export function isTaskClosed(status: CallStatusId): boolean {
  return [
    'chiamato',
    'cambio_rottamazione_macchina',
    'non_gradito',
    'ripreso',
    'cliente_perso',
  ].includes(status);
}

export function isTaskExpired(
  task: CallTask,
  referenceDate = getItalyDate(),
): boolean {
  return !isTaskClosed(task.status) && task.eventDate < referenceDate;
}

export function isTaskBeforeTrackingStart(task: CallTask): boolean {
  return !isTaskClosed(task.status) &&
    getTaskEffectiveDate(task) < CALL_TRACKING_START_DATE;
}

export function isTaskCampaignWindowOpen(
  task: CallTask,
  referenceDate = getItalyDate(),
): boolean {
  return true;
}

export function isTaskActionable(
  task: CallTask,
  referenceDate = getItalyDate(),
): boolean {
  const effectiveDate = getTaskEffectiveDate(task);
  return !isTaskClosed(task.status) &&
    isTaskCampaignWindowOpen(task, referenceDate) &&
    !isTaskBeforeTrackingStart(task) &&
    effectiveDate <= referenceDate &&
    task.eventDate >= referenceDate;
}

function buildTasksForRow(
  worksheet: WorksheetLike,
  rowNumber: number,
  columns: WinbackColumns,
): ParsedImport['tasks'] {
  const task = buildWinbackTask(worksheet, rowNumber, columns);
  return task ? [task] : [];
}

function buildNewClientRecord(
  worksheet: WorksheetLike,
  rowNumber: number,
  columns: NewClientColumns,
): NewClientRecord | undefined {
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const startDate = getCellDate(worksheet, rowNumber, columns.relationshipStartDate);
  const birthDate = getCellDate(worksheet, rowNumber, columns.birthDate);

  if (!clientName || !source.code || !startDate) return undefined;

  return createNewClientRecord({
    clientName,
    fiscalCode: normalizeTaxIdentifier(getOptionalCellText(
      worksheet,
      rowNumber,
      columns.fiscalCode,
    )),
    phone: getCellPhone(worksheet, rowNumber, columns.phone),
    sourceCode: source.code,
    sourceName: source.name,
    sourceOwnerEmail: source.ownerEmail,
    sourceOwnerName: source.ownerName,
    coverages: getCellText(worksheet, rowNumber, columns.coverages),
    birthDate: birthDate ? format(birthDate, DATE_FORMAT) : '',
    relationshipStartDate: format(startDate, DATE_FORMAT),
  });
}

function createNewClientRecord(
  values: Omit<
    NewClientRecord,
    'id' | 'dedupeKey' | 'fallbackDedupeKey' | 'sourceFingerprint' |
    'importedAt' | 'createdAt'
  >,
): NewClientRecord {
  const fallbackDedupeKey = getNewClientFallbackDedupeKey(values);
  const dedupeKey = values.fiscalCode
    ? `tax|${normalizeTaxIdentifier(values.fiscalCode)}`
    : fallbackDedupeKey;
  const semanticValues = {
    ...values,
    fiscalCode: normalizeTaxIdentifier(values.fiscalCode),
    dedupeKey,
    fallbackDedupeKey,
  };

  return {
    id: `new_client_${stableHash(dedupeKey)}`,
    ...semanticValues,
    sourceFingerprint: stableHash(JSON.stringify(semanticValues)),
  };
}

function dedupeNewClientRecords(
  clients: NewClientRecord[],
): { records: NewClientRecord[]; duplicateRows: number } {
  const records: NewClientRecord[] = [];
  let duplicateRows = 0;

  for (const client of clients) {
    const existingIndex = records.findIndex(record =>
      areSameNewClient(record, client)
    );
    if (existingIndex < 0) {
      records.push(client);
      continue;
    }

    records[existingIndex] = mergeNewClientRecords(records[existingIndex], client);
    duplicateRows += 1;
  }

  return { records, duplicateRows };
}

function areSameNewClient(
  first: Partial<NewClientRecord>,
  second: Partial<NewClientRecord>,
): boolean {
  const firstFiscalCode = normalizeTaxIdentifier(first.fiscalCode || '');
  const secondFiscalCode = normalizeTaxIdentifier(second.fiscalCode || '');

  if (firstFiscalCode && secondFiscalCode) {
    return firstFiscalCode === secondFiscalCode;
  }

  return getNewClientFallbackDedupeKey(first) ===
    getNewClientFallbackDedupeKey(second);
}

function mergeNewClientRecords(
  previous: NewClientRecord,
  incoming: NewClientRecord,
): NewClientRecord {
  const relationshipStartDate = [
    previous.relationshipStartDate,
    incoming.relationshipStartDate,
  ].filter(Boolean).sort()[0] || '';

  return createNewClientRecord({
    clientName: incoming.clientName || previous.clientName,
    fiscalCode: incoming.fiscalCode || previous.fiscalCode || '',
    phone: incoming.phone || previous.phone,
    sourceCode: incoming.sourceCode || previous.sourceCode,
    sourceName: incoming.sourceName || previous.sourceName,
    sourceOwnerEmail: incoming.sourceOwnerEmail || previous.sourceOwnerEmail,
    sourceOwnerName: incoming.sourceOwnerName || previous.sourceOwnerName,
    coverages: incoming.coverages || previous.coverages,
    birthDate: incoming.birthDate || previous.birthDate,
    relationshipStartDate,
  });
}

function getNewClientFallbackDedupeKey(
  client: Pick<Partial<NewClientRecord>, 'clientName' | 'birthDate' | 'sourceCode'>,
): string {
  return [
    'person',
    normalizePersonName(client.clientName || ''),
    client.birthDate || '',
    client.sourceCode || '',
  ].join('|');
}

function normalizePersonName(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function normalizeTaxIdentifier(value: string): string {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '');
}

function buildCampaignTasksForClient(
  client: NewClientRecord,
  campaigns: Campaign[],
): ParsedImport['tasks'] {
  return campaigns.filter(isNewClientCampaign).map(campaign => {
    const monthsAfterStart = campaign.monthsAfterStart || 0;
    if (monthsAfterStart < 1) return undefined;

    const startDate = parseISO(client.relationshipStartDate);
    const eventDate = adjustWeekendToMonday(
      addMonths(startDate, monthsAfterStart)
    );
    const dueDate = format(eventDate, DATE_FORMAT);
    if (campaign.startDate && dueDate < campaign.startDate) {
      return undefined;
    }
    const identity = [
      'campaign',
      getNewClientFallbackDedupeKey(client),
      campaign.id,
    ].join('|');
    const id = `campaign_${stableHash(identity)}`;

    return createTask({
      id,
      importType: 'newClients',
      category: 'campagna',
      categoryLabel: campaign.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      clientName: client.clientName,
      phone: client.phone,
      source: {
        code: client.sourceCode,
        name: client.sourceName,
        ownerEmail: client.sourceOwnerEmail,
        ownerName: client.sourceOwnerName,
      },
      coverages: client.coverages,
      fiscalCode: client.fiscalCode || '',
      birthDate: client.birthDate,
      relationshipStartDate: client.relationshipStartDate,
      eventDate: dueDate,
      dueDate,
    });
  }).filter((task): task is ParsedImport['tasks'][number] => Boolean(task));
}

function getExpirationColumnResolution(
  worksheet: WorksheetLike,
): ColumnResolution<ExpirationColumns> {
  const exactResolution = resolveExactHeaderColumns(
    worksheet,
    WIDE_EXPIRATION_HEADER_COLUMNS,
  );

  if (exactResolution.missingRequiredHeaders.length === 0) {
    return {
      ...exactResolution,
      columns: {
        fullName: exactResolution.columns.fullName,
        policyNumber: '',
        source: exactResolution.columns.source,
        policyType: '',
        fiscalCode: exactResolution.columns.fiscalCode,
        expirationType: '',
        nextExpirationDate: exactResolution.columns.nextExpirationDate,
        vehiclePlate: '',
        phone: exactResolution.columns.phone,
        autoPremium: exactResolution.columns.autoPremium,
      },
    };
  }

  return describeLegacyColumns(
    worksheet,
    { ...CLIENT_IMPORT_CONFIG.expirations.columns } as ExpirationColumns,
    EXPIRATION_COLUMN_LABELS,
  );
}

function getWinbackColumnResolution(
  worksheet: WorksheetLike,
): ColumnResolution<WinbackColumns> {
  return describeLegacyColumns(
    worksheet,
    { ...CLIENT_IMPORT_CONFIG.winback.columns } as WinbackColumns,
    WINBACK_COLUMN_LABELS,
  );
}

function buildAnnualExpirationRecord(
  worksheet: WorksheetLike,
  rowNumber: number,
  columns: ExpirationColumns,
): ExpirationRecord | undefined {
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const policyNumber = getOptionalCellText(worksheet, rowNumber, columns.policyNumber);
  const fiscalCode = getOptionalCellText(worksheet, rowNumber, columns.fiscalCode);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const expirationType = getOptionalCellText(
    worksheet,
    rowNumber,
    columns.expirationType,
  ).toUpperCase();
  const eventDate = getCellDate(worksheet, rowNumber, columns.nextExpirationDate);

  if (!clientName || !source.code || !eventDate || (!policyNumber && !fiscalCode)) {
    return undefined;
  }

  const expirationIdentity = policyNumber || fiscalCode || `${clientName}|${source.code}`;
  const identity = [
    'client-expiration-record',
    expirationIdentity,
    fiscalCode,
    format(eventDate, DATE_FORMAT),
  ].join('|');
  const baseRecord = {
    id: `expiration_record_${stableHash(identity)}`,
    clientName,
    phone: getCellPhone(worksheet, rowNumber, columns.phone),
    sourceCode: source.code,
    sourceName: source.name,
    sourceOwnerEmail: source.ownerEmail,
    sourceOwnerName: source.ownerName,
    policyNumber,
    policyType: getOptionalCellText(worksheet, rowNumber, columns.policyType),
    fiscalCode,
    expirationType,
    vehiclePlate: getOptionalCellText(worksheet, rowNumber, columns.vehiclePlate),
    autoPremium: getOptionalCellText(worksheet, rowNumber, columns.autoPremium),
    eventDate: format(eventDate, DATE_FORMAT),
  };

  return {
    ...baseRecord,
    sourceFingerprint: stableHash(JSON.stringify(baseRecord)),
  };
}

function buildAnnualExpirationCampaignTasks(
  record: ExpirationRecord,
  campaigns: Campaign[],
): ParsedImport['tasks'] {
  if (!isExplicitAnnualExpiration(record)) {
    return [];
  }

  return campaigns.filter(isAnnualExpirationCampaign).map(campaign => {
    const daysBeforeExpiration = campaign.daysBeforeExpiration || 0;
    if (daysBeforeExpiration < 1) return undefined;

    const eventDate = parseISO(record.eventDate);
    const dueDate = adjustWeekendToMonday(subDays(eventDate, daysBeforeExpiration));
    if (campaign.startDate) {
      const campaignStartDate = parseISO(campaign.startDate);
      if (eventDate < campaignStartDate || dueDate < campaignStartDate) {
        return undefined;
      }
    }
    const identity = [
      'annual-expiration-campaign',
      campaign.id,
      getExpirationRecordIdentity(record),
      record.eventDate,
    ].join('|');

    return createTask({
      id: `expiration_campaign_${stableHash(identity)}`,
      importType: 'expirations',
      category: 'campagna',
      categoryLabel: campaign.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      clientName: record.clientName,
      phone: record.phone,
      source: {
        code: record.sourceCode,
        name: record.sourceName,
        ownerEmail: record.sourceOwnerEmail,
        ownerName: record.sourceOwnerName,
      },
      policyNumber: record.policyNumber,
      policyType: record.policyType,
      fiscalCode: record.fiscalCode,
      expirationType: record.expirationType,
      vehiclePlate: record.vehiclePlate,
      autoPremium: record.autoPremium,
      eventDate: record.eventDate,
      dueDate: format(dueDate, DATE_FORMAT),
    });
  }).filter((task): task is ParsedImport['tasks'][number] => Boolean(task));
}

function getExpirationRecordIdentity(record: Pick<
  ExpirationRecord,
  'policyNumber' | 'fiscalCode' | 'clientName' | 'sourceCode'
>): string {
  return record.policyNumber ||
    record.fiscalCode ||
    `${record.clientName}|${record.sourceCode}`;
}

function getExpirationTaskIdentity(task: Partial<CallTask>): string {
  return task.policyNumber ||
    task.fiscalCode ||
    `${task.clientName || ''}|${task.sourceCode || ''}`;
}

export function getNextExpirationEvent(
  baseDate: Date,
  monthsToAdd: number,
  referenceDate: Date,
): Date {
  let eventDate = addMonths(baseDate, monthsToAdd);

  while (eventDate < referenceDate) {
    eventDate = addMonths(eventDate, monthsToAdd);
  }

  return eventDate;
}

export function getCampaignKind(campaign: Campaign): CampaignKind {
  return campaign.campaignKind || 'newClients';
}

export function isCampaignTaskEligible(
  task: Pick<CallTask, 'category' | 'expirationType' | 'policyNumber'>,
  campaign: Campaign,
): boolean {
  return task.category !== 'campagna' ||
    getCampaignKind(campaign) !== 'annualExpirations' ||
    isExplicitAnnualExpiration(task);
}

function isExplicitAnnualExpiration(
  expiration: Pick<ExpirationRecord, 'expirationType' | 'policyNumber'>,
): boolean {
  return Boolean(expiration.policyNumber?.trim()) &&
    (expiration.expirationType || '').trim().toUpperCase() === 'A';
}

function isNewClientCampaign(campaign: Campaign): boolean {
  return getCampaignKind(campaign) === 'newClients';
}

function isAnnualExpirationCampaign(campaign: Campaign): boolean {
  return getCampaignKind(campaign) === 'annualExpirations';
}

function annualExpirationRecordFromTask(
  id: string,
  task: CallTask,
): ExpirationRecord | undefined {
  if (task.category !== 'scadenza_annuale') {
    return undefined;
  }

  const recordId = `expiration_record_${stableHash([
    'client-expiration-record',
    getExpirationTaskIdentity(task),
    task.fiscalCode,
    task.eventDate,
  ].join('|'))}`;
  const baseRecord = {
    id: recordId || id,
    clientName: task.clientName,
    phone: normalizePhone(task.phone),
    sourceCode: task.sourceCode,
    sourceName: task.sourceName,
    sourceOwnerEmail: task.sourceOwnerEmail,
    sourceOwnerName: task.sourceOwnerName,
    policyNumber: task.policyNumber,
    policyType: task.policyType,
    fiscalCode: task.fiscalCode,
    expirationType: task.expirationType,
    vehiclePlate: task.vehiclePlate,
    autoPremium: task.autoPremium,
    eventDate: task.eventDate,
  };

  return {
    ...baseRecord,
    sourceFingerprint: stableHash(JSON.stringify(baseRecord)),
  };
}

function buildWinbackTask(
  worksheet: WorksheetLike,
  rowNumber: number,
  columns: WinbackColumns,
): ParsedImport['tasks'][number] | undefined {
  const config = CLIENT_IMPORT_CONFIG.winback;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const policyNumber = getCellText(worksheet, rowNumber, columns.policyNumber);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const exitDate = getCellDate(worksheet, rowNumber, columns.exitDate);
  const lastGrossPremium = getAnnualizedWinbackPremium(
    worksheet,
    rowNumber,
    columns.lastGrossPremium,
    columns.premiumFrequency,
  );

  if (!clientName || !policyNumber || !source.code || !exitDate) return undefined;

  const eventDate = getNextEligibleWinbackAnniversary(exitDate);
  if (!eventDate) return undefined;

  const dueDate = adjustWeekendToMonday(
    subDays(eventDate, config.scheduleRule.reminderDays)
  );
  const identity = [
    'winback',
    policyNumber,
    format(exitDate, DATE_FORMAT),
    format(eventDate, DATE_FORMAT),
  ].join('|');

  return createTask({
    id: `winback_${stableHash(identity)}`,
    importType: 'winback',
    category: 'winback',
    categoryLabel: 'Winback',
    clientName,
    phone: getCellPhone(worksheet, rowNumber, columns.phone),
    source,
    policyNumber,
    vehiclePlate: getCellText(worksheet, rowNumber, columns.vehiclePlate),
    exitDate: format(exitDate, DATE_FORMAT),
    lastGrossPremium,
    eventDate: format(eventDate, DATE_FORMAT),
    dueDate: format(dueDate, DATE_FORMAT),
  });
}

export function getNextEligibleWinbackAnniversary(
  exitDate: Date,
  referenceDate = parseISO(getItalyDate()),
): Date | undefined {
  const referenceYear = referenceDate.getFullYear();
  let anniversaryNumber = referenceYear - exitDate.getFullYear();
  let eventDate = addYears(exitDate, anniversaryNumber);

  // Se l'anniversario di quest'anno e' gia' trascorso, prepara il ciclo
  // dell'anno successivo. Il giorno dell'anniversario resta ancora lavorabile.
  if (format(eventDate, DATE_FORMAT) < format(referenceDate, DATE_FORMAT)) {
    anniversaryNumber += 1;
    eventDate = addYears(exitDate, anniversaryNumber);
  }

  const isEligible = CLIENT_IMPORT_CONFIG.winback.scheduleRule.anniversaryYears
    .some(year => year === anniversaryNumber);

  return isEligible ? eventDate : undefined;
}

function createTask(
  values: {
    id: string;
    importType: ImportKind;
    category: CallCategory;
    categoryLabel: string;
    clientName: string;
    phone: string;
    source: ReturnType<typeof resolveSource>;
    dueDate: string;
    eventDate: string;
  } & Partial<CallTask>
): ParsedImport['tasks'][number] {
  const { source, ...taskValues } = values;
  const baseTask = {
    campaignId: '',
    campaignName: '',
    policyNumber: '',
    policyType: '',
    fiscalCode: '',
    expirationType: '',
    vehiclePlate: '',
    autoPremium: '',
    coverages: '',
    birthDate: '',
    relationshipStartDate: '',
    exitDate: '',
    lastGrossPremium: '',
    ...taskValues,
    sourceCode: source.code,
    sourceName: source.name,
    sourceOwnerEmail: source.ownerEmail,
    sourceOwnerName: source.ownerName,
  };

  return {
    ...baseTask,
    sourceFingerprint: stableHash(JSON.stringify(baseTask)),
  };
}

function getCellText(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): string {
  return worksheet.getCell(rowNumber, columnToNumber(column)).text.trim();
}

function getAnnualizedWinbackPremium(
  worksheet: WorksheetLike,
  rowNumber: number,
  premiumColumn: string,
  frequencyColumn: string,
): string {
  const rawPremium = getCellText(worksheet, rowNumber, premiumColumn);
  if (!rawPremium) return '';

  const frequency = normalizeText(
    getCellText(worksheet, rowNumber, frequencyColumn),
  );
  if (frequency !== 'S') return rawPremium;

  const numericPremium = getCellNumber(
    worksheet,
    rowNumber,
    premiumColumn,
  );
  if (numericPremium === undefined) return rawPremium;

  return new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numericPremium * 2);
}

function getCellNumber(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): number | undefined {
  const cell = worksheet.getCell(rowNumber, columnToNumber(column));
  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return cell.value;
  }

  const cleaned = cell.text.trim()
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  if (!cleaned) return undefined;

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getOptionalCellText(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): string {
  return column ? getCellText(worksheet, rowNumber, column) : '';
}

function getCellPhone(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): string {
  return normalizePhone(getCellText(worksheet, rowNumber, column));
}

function normalizePhone(value: string): string {
  const normalized = normalizeText(value);
  if (!normalized || ['SI', 'SÌ', 'NO', 'TRUE', 'FALSE'].includes(normalized)) {
    return '';
  }

  return /\d/.test(value) ? value.trim() : '';
}

function getCellDate(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): Date | undefined {
  const cell = worksheet.getCell(rowNumber, columnToNumber(column));

  if (cell.value instanceof Date && isValid(cell.value)) {
    return new Date(
      cell.value.getUTCFullYear(),
      cell.value.getUTCMonth(),
      cell.value.getUTCDate(),
    );
  }

  const text = cell.text.trim();
  if (!text) return undefined;

  const formats = ['dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy', 'd-M-yyyy'];
  for (const dateFormat of formats) {
    const parsed = parse(text, dateFormat, new Date());
    if (isValid(parsed)) return parsed;
  }

  const isoDate = parseISO(text);
  return isValid(isoDate) ? isoDate : undefined;
}

function resolveSource(rawValue: string) {
  const raw = rawValue.trim();
  const match = raw.match(/^(\d{1,3}(?:-\d{1,3})?)/);
  let code = match?.[1] || '';

  if (/^\d+$/.test(code) && code.length < 3) {
    code = code.padStart(3, '0');
  }

  const aliases = CLIENT_IMPORT_CONFIG.sourceCodeAliases as Record<string, string>;
  code = aliases[code] || code;

  const candidates = SOURCE_DIRECTORY.filter(item => item.code === code);
  const normalizedRaw = normalizeText(raw);
  const matchingCandidate = candidates.find(item =>
    normalizedRaw.includes(normalizeText(item.name))
  );
  const sourceName = matchingCandidate?.name ||
    (candidates.length === 1 ? candidates[0].name : `Fonte ${code}`);
  const owner = AUTHORIZED_EMPLOYEES.find(employee =>
    employee.sourceCodes.some(sourceCode => sourceCode === code)
  );

  return {
    code,
    name: sourceName,
    ownerEmail: owner?.email || '',
    ownerName: owner?.name || '',
  };
}

function columnToNumber(column: string): number {
  return [...column].reduce(
    (value, character) => value * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function stableHash(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}
