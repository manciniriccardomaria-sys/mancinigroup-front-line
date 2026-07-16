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
  phone: string;
  sourceCode: string;
  sourceName: string;
  sourceOwnerEmail: string;
  sourceOwnerName: string;
  coverages: string;
  birthDate: string;
  relationshipStartDate: string;
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
  tasks: Array<Omit<CallTask, 'status' | 'id'> & { id: string }>;
  newClients?: NewClientRecord[];
  expirationRecords?: ExpirationRecord[];
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skippedRows: number;
  totalRows: number;
  generatedTasks: number;
  storedClients: number;
  storedExpirations: number;
};

type WorksheetLike = {
  rowCount: number;
  getCell(row: number, column: number): {
    value: unknown;
    text: string;
  };
};

const DATE_FORMAT = 'yyyy-MM-dd';
export const CALL_TRACKING_START_DATE = '2026-06-19';

export async function parseClientWorkbook(
  file: File,
  kind: ImportKind,
  campaigns: Campaign[],
): Promise<ParsedImport> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer as never);

  const config = CLIENT_IMPORT_CONFIG[kind];
  const requestedSheetName = config.sheetName;
  const worksheet = workbook.getWorksheet(requestedSheetName) ||
    (kind === 'winback' ? workbook.worksheets[0] : undefined);

  if (!worksheet) {
    throw new Error(`Scheda "${requestedSheetName}" non trovata nel file.`);
  }

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
      );

      if (!client) {
        skippedRows += 1;
        continue;
      }

      newClients.push(client);
      tasks.push(...buildCampaignTasksForClient(client, activeNewClientCampaigns));
      continue;
    }

    if (kind === 'expirations') {
      const expirationRecord = buildAnnualExpirationRecord(
        worksheet as WorksheetLike,
        rowNumber,
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
      kind,
    );

    if (generated.length === 0) {
      skippedRows += 1;
      continue;
    }

    tasks.push(...generated);
  }

  return {
    kind,
    fileName: file.name,
    sheetName: worksheet.name || requestedSheetName,
    rowCount: Math.max(0, worksheet.rowCount - 1),
    skippedRows,
    tasks,
    ...(kind === 'newClients' ? { newClients } : {}),
    ...(kind === 'expirations' ? { expirationRecords } : {}),
  };
}

export async function importCallTasks(parsed: ParsedImport): Promise<ImportResult> {
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
      },
    ])
  );
  const existingByLogicalKey = new Map(
    existingSnapshot.docs.map(item => [
      getTaskLogicalKey(item.data() as Partial<CallTask>),
      {
        id: item.id,
        fingerprint: item.data().sourceFingerprint as string | undefined,
      },
    ])
  );

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let batch = writeBatch(db);
  let batchSize = 0;

  const commitBatch = async () => {
    if (batchSize === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchSize = 0;
  };

  for (const task of parsed.tasks) {
    const existingTask = existingById.get(task.id) ||
      existingByLogicalKey.get(getTaskLogicalKey(task));
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
    skippedRows: parsed.skippedRows,
    totalRows: parsed.rowCount,
    generatedTasks: parsed.tasks.length,
    storedClients,
    storedExpirations,
  };

  await addDoc(collection(db, 'import_runs'), {
    importType: parsed.kind,
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    ...result,
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
      skippedRows: 0,
      totalRows: 0,
      generatedTasks: 0,
      storedClients: 0,
      storedExpirations: 0,
    };
  }

  if (isAnnualExpirationCampaign(campaign)) {
    const expirationRecords = await loadStoredAnnualExpirationRecords();

    return importCallTasks({
      kind: 'expirations',
      fileName: 'Scadenze clienti memorizzate',
      sheetName: CLIENT_IMPORT_CONFIG.expirations.sheetName,
      rowCount: expirationRecords.length,
      skippedRows: 0,
      tasks: expirationRecords.flatMap(record =>
        buildAnnualExpirationCampaignTasks(record, [campaign])
      ),
    });
  }

  const clientsSnapshot = await getDocs(collection(db, 'new_clients'));
  const clients = clientsSnapshot.docs.map(item => ({
    id: item.id,
    ...item.data(),
  } as NewClientRecord));

  return importCallTasks({
    kind: 'newClients',
    fileName: 'Clienti memorizzati',
    sheetName: CLIENT_IMPORT_CONFIG.newClients.sheetName,
    rowCount: clients.length,
    skippedRows: 0,
    tasks: clients.flatMap(client =>
      buildCampaignTasksForClient(client, [campaign])
    ),
  });
}

async function importNewClientRecords(
  clients: NewClientRecord[],
): Promise<number> {
  const existingSnapshot = await getDocs(collection(db, 'new_clients'));
  const existingById = new Map(
    existingSnapshot.docs.map(item => [
      item.id,
      item.data().sourceFingerprint as string | undefined,
    ])
  );

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
    const previousFingerprint = existingById.get(client.id);
    if (previousFingerprint === client.sourceFingerprint) continue;

    batch.set(doc(db, 'new_clients', client.id), {
      ...client,
      importedAt: serverTimestamp(),
      ...(previousFingerprint === undefined
        ? { createdAt: serverTimestamp() }
        : {}),
    }, { merge: true });
    batchSize += 1;
    storedClients += 1;

    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();
  return storedClients;
}

async function importExpirationRecords(
  expirations: ExpirationRecord[],
): Promise<number> {
  const existingSnapshot = await getDocs(collection(db, 'expiration_records'));
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
    if (task.category === 'campagna') {
      return [
        task.importType,
        task.campaignId,
        task.policyNumber,
        task.expirationType,
        task.eventDate,
      ].join('|');
    }

    return [
      task.importType,
      task.policyNumber,
      task.expirationType,
      task.eventDate,
    ].join('|');
  }

  if (task.importType === 'winback') {
    return [
      task.importType,
      task.policyNumber,
      task.exitDate,
    ].join('|');
  }

  return [
    task.importType,
    task.campaignId,
    task.clientName,
    task.birthDate,
    task.sourceCode,
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
  kind: ImportKind,
): ParsedImport['tasks'] {
  const task = buildWinbackTask(worksheet, rowNumber);
  return task ? [task] : [];
}

function buildNewClientRecord(
  worksheet: WorksheetLike,
  rowNumber: number,
): NewClientRecord | undefined {
  const columns = CLIENT_IMPORT_CONFIG.newClients.columns;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const startDate = getCellDate(worksheet, rowNumber, columns.relationshipStartDate);
  const birthDate = getCellDate(worksheet, rowNumber, columns.birthDate);

  if (!clientName || !source.code || !startDate) return undefined;

  const identity = [
    'new-client',
    clientName,
    birthDate ? format(birthDate, DATE_FORMAT) : '',
    source.code,
  ].join('|');
  const baseClient = {
    id: `new_client_${stableHash(identity)}`,
    clientName,
    phone: getCellPhone(worksheet, rowNumber, columns.phone),
    sourceCode: source.code,
    sourceName: source.name,
    sourceOwnerEmail: source.ownerEmail,
    sourceOwnerName: source.ownerName,
    coverages: getCellText(worksheet, rowNumber, columns.coverages),
    birthDate: birthDate ? format(birthDate, DATE_FORMAT) : '',
    relationshipStartDate: format(startDate, DATE_FORMAT),
  };

  return {
    ...baseClient,
    sourceFingerprint: stableHash(JSON.stringify(baseClient)),
  };
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
    const identity = [
      'campaign',
      client.clientName,
      client.birthDate,
      client.sourceCode,
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
      birthDate: client.birthDate,
      relationshipStartDate: client.relationshipStartDate,
      eventDate: format(eventDate, DATE_FORMAT),
      dueDate: format(eventDate, DATE_FORMAT),
    });
  }).filter((task): task is ParsedImport['tasks'][number] => Boolean(task));
}

function buildAnnualExpirationRecord(
  worksheet: WorksheetLike,
  rowNumber: number,
): ExpirationRecord | undefined {
  const config = CLIENT_IMPORT_CONFIG.expirations;
  const columns = config.columns;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const policyNumber = getCellText(worksheet, rowNumber, columns.policyNumber);
  const fiscalCode = getCellText(worksheet, rowNumber, columns.fiscalCode);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const expirationType = getCellText(worksheet, rowNumber, columns.expirationType).toUpperCase();
  const eventDate = getCellDate(worksheet, rowNumber, columns.nextExpirationDate);

  if (!clientName || !policyNumber || !source.code || !eventDate) {
    return undefined;
  }

  const identity = [
    'client-expiration-record',
    policyNumber,
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
    policyType: getCellText(worksheet, rowNumber, columns.policyType),
    fiscalCode,
    expirationType,
    vehiclePlate: getCellText(worksheet, rowNumber, columns.vehiclePlate),
    autoPremium: getCellText(worksheet, rowNumber, columns.autoPremium),
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
  return campaigns.filter(isAnnualExpirationCampaign).map(campaign => {
    const daysBeforeExpiration = campaign.daysBeforeExpiration || 0;
    if (daysBeforeExpiration < 1) return undefined;

    const eventDate = parseISO(record.eventDate);
    const dueDate = applyMinimumDate(
      adjustWeekendToMonday(subDays(eventDate, daysBeforeExpiration)),
      campaign.startDate
    );
    const identity = [
      'annual-expiration-campaign',
      campaign.id,
      record.policyNumber,
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

function applyMinimumDate(date: Date, minimumDate?: string): Date {
  if (!minimumDate) return date;
  const parsedMinimumDate = parseISO(minimumDate);
  return date < parsedMinimumDate ? parsedMinimumDate : date;
}

export function getCampaignKind(campaign: Campaign): CampaignKind {
  return campaign.campaignKind || 'newClients';
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
    task.policyNumber,
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
): ParsedImport['tasks'][number] | undefined {
  const config = CLIENT_IMPORT_CONFIG.winback;
  const columns = config.columns;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const policyNumber = getCellText(worksheet, rowNumber, columns.policyNumber);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const exitDate = getCellDate(worksheet, rowNumber, columns.exitDate);

  if (!clientName || !policyNumber || !source.code || !exitDate) return undefined;

  const eventDate = addYears(exitDate, 1);
  const dueDate = adjustWeekendToMonday(
    subDays(eventDate, config.scheduleRule.reminderDays)
  );
  const identity = [
    'winback',
    policyNumber,
    format(exitDate, DATE_FORMAT),
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
    lastGrossPremium: getCellText(
      worksheet,
      rowNumber,
      columns.lastGrossPremium,
    ),
    eventDate: format(eventDate, DATE_FORMAT),
    dueDate: format(dueDate, DATE_FORMAT),
  });
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
