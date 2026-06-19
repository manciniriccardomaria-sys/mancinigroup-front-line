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

export type Campaign = {
  id: string;
  name: string;
  description: string;
  monthsAfterStart: number;
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
  expirationType: string;
  vehiclePlate: string;
  coverages: string;
  birthDate: string;
  relationshipStartDate: string;
  exitDate: string;
  lastGrossPremium: string;
  eventDate: string;
  dueDate: string;
  status: CallStatusId;
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

export type ParsedImport = {
  kind: ImportKind;
  fileName: string;
  sheetName: string;
  rowCount: number;
  skippedRows: number;
  tasks: Array<Omit<CallTask, 'status' | 'id'> & { id: string }>;
};

export type ImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skippedRows: number;
  totalRows: number;
  generatedTasks: number;
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
  const worksheet = workbook.getWorksheet(config.sheetName);

  if (!worksheet) {
    throw new Error(`Scheda "${config.sheetName}" non trovata nel file.`);
  }

  if (kind === 'newClients' && campaigns.filter(item => item.active).length === 0) {
    throw new Error('Crea almeno una campagna attiva prima di importare i nuovi clienti.');
  }

  const tasks: ParsedImport['tasks'] = [];
  let skippedRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const generated = buildTasksForRow(
      worksheet as WorksheetLike,
      rowNumber,
      kind,
      campaigns.filter(item => item.active),
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
    sheetName: config.sheetName,
    rowCount: Math.max(0, worksheet.rowCount - 1),
    skippedRows,
    tasks,
  };
}

export async function importCallTasks(parsed: ParsedImport): Promise<ImportResult> {
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

function getTaskLogicalKey(task: Partial<CallTask>): string {
  if (task.importType === 'expirations') {
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

export function isTaskActionable(
  task: CallTask,
  referenceDate = getItalyDate(),
): boolean {
  const effectiveDate = getTaskEffectiveDate(task);
  return !isTaskClosed(task.status) &&
    !isTaskBeforeTrackingStart(task) &&
    effectiveDate <= referenceDate &&
    task.eventDate >= referenceDate;
}

function buildTasksForRow(
  worksheet: WorksheetLike,
  rowNumber: number,
  kind: ImportKind,
  campaigns: Campaign[],
): ParsedImport['tasks'] {
  if (kind === 'newClients') {
    return buildNewClientTasks(worksheet, rowNumber, campaigns);
  }

  if (kind === 'expirations') {
    const task = buildExpirationTask(worksheet, rowNumber);
    return task ? [task] : [];
  }

  const task = buildWinbackTask(worksheet, rowNumber);
  return task ? [task] : [];
}

function buildNewClientTasks(
  worksheet: WorksheetLike,
  rowNumber: number,
  campaigns: Campaign[],
): ParsedImport['tasks'] {
  const columns = CLIENT_IMPORT_CONFIG.newClients.columns;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const startDate = getCellDate(worksheet, rowNumber, columns.relationshipStartDate);
  const birthDate = getCellDate(worksheet, rowNumber, columns.birthDate);

  if (!clientName || !source.code || !startDate) return [];

  return campaigns.map(campaign => {
    const eventDate = addMonths(startDate, campaign.monthsAfterStart);
    const dueDate = adjustWeekendToMonday(eventDate);
    const identity = [
      'campaign',
      clientName,
      birthDate ? format(birthDate, DATE_FORMAT) : '',
      source.code,
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
      clientName,
      phone: getCellText(worksheet, rowNumber, columns.phone),
      source,
      coverages: getCellText(worksheet, rowNumber, columns.coverages),
      birthDate: birthDate ? format(birthDate, DATE_FORMAT) : '',
      relationshipStartDate: format(startDate, DATE_FORMAT),
      eventDate: format(eventDate, DATE_FORMAT),
      dueDate: format(dueDate, DATE_FORMAT),
    });
  });
}

function buildExpirationTask(
  worksheet: WorksheetLike,
  rowNumber: number,
): ParsedImport['tasks'][number] | undefined {
  const config = CLIENT_IMPORT_CONFIG.expirations;
  const columns = config.columns;
  const clientName = getCellText(worksheet, rowNumber, columns.fullName);
  const policyNumber = getCellText(worksheet, rowNumber, columns.policyNumber);
  const source = resolveSource(getCellText(worksheet, rowNumber, columns.source));
  const expirationType = getCellText(
    worksheet,
    rowNumber,
    columns.expirationType,
  ).toUpperCase() as 'R' | 'A';
  const baseDate = getCellDate(worksheet, rowNumber, columns.baseDate);
  const expirationRule = config.scheduleRule.expirationTypes[expirationType];

  if (!clientName || !policyNumber || !source.code || !baseDate || !expirationRule) {
    return undefined;
  }

  const eventDate = getNextExpirationEvent(
    baseDate,
    expirationRule.monthsToAdd,
    parseISO(getItalyDate()),
  );
  const dueDate = adjustWeekendToMonday(
    subDays(eventDate, config.scheduleRule.reminderDays)
  );
  const identity = [
    'expiration',
    policyNumber,
    expirationType,
    format(eventDate, DATE_FORMAT),
  ].join('|');

  return createTask({
    id: `expiration_${stableHash(identity)}`,
    importType: 'expirations',
    category: expirationType === 'R' ? 'scadenza_rata' : 'scadenza_annuale',
    categoryLabel: expirationType === 'R' ? 'Scadenza rata' : 'Scadenza annuale',
    clientName,
    phone: getCellText(worksheet, rowNumber, columns.phone),
    source,
    policyNumber,
    policyType: getCellText(worksheet, rowNumber, columns.policyType),
    expirationType,
    vehiclePlate: getCellText(worksheet, rowNumber, columns.vehiclePlate),
    eventDate: format(eventDate, DATE_FORMAT),
    dueDate: format(dueDate, DATE_FORMAT),
  });
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
    phone: getCellText(worksheet, rowNumber, columns.phone),
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
    expirationType: '',
    vehiclePlate: '',
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
