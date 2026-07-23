import { format, isValid, parse, parseISO } from 'date-fns';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { AUTHORIZED_EMPLOYEES } from './constants';
import { CLIENT_IMPORT_CONFIG } from './clientImportConfig';
import { SOURCE_DIRECTORY } from './sourceDirectory';

export const CUSTOMER_CLUSTER_ALLOWED_EMPLOYEE_EMAIL = 'rossellamancinigroup@gmail.com';

export type CustomerClusterBucket = '1' | '2' | '3' | '4' | '5' | '>5';

export type CustomerClusterRecord = {
  id: string;
  clientName: string;
  sourceCode: string;
  sourceName: string;
  sourceOwnerEmail: string;
  sourceOwnerName: string;
  quietanzaDate: string;
  birthDate: string;
  address: string;
  phone: string;
  customerTenure: number;
  policyCount: number;
  policyBucket: CustomerClusterBucket;
  starLevel: number;
  annualPremium: number;
  agencyCommissions: number;
  recommendation: string;
  sourceFingerprint: string;
  importedAt?: unknown;
  createdAt?: unknown;
};

export type ParsedCustomerClusterImport = {
  fileName: string;
  sheetName: string;
  rowCount: number;
  skippedRows: number;
  duplicateRows: number;
  records: CustomerClusterRecord[];
};

export type CustomerClusterImportResult = {
  created: number;
  updated: number;
  unchanged: number;
  skippedRows: number;
  duplicateRows: number;
  totalRows: number;
  importedRecords: number;
};

type WorksheetLike = {
  name: string;
  rowCount: number;
  getCell(row: number, column: number): {
    value: unknown;
    text: string;
  };
};

const DATE_FORMAT = 'yyyy-MM-dd';
const CLUSTER_COLUMNS = {
  clientName: 'A',
  source: 'G',
  quietanzaDate: 'H',
  birthDate: 'U',
  address: 'X',
  phone: 'AC',
  customerTenure: 'BE',
  customerTenureFallback: 'BF',
  policyCount: 'BI',
  annualPremium: 'CR',
  agencyCommissions: 'CW',
} as const;

export async function parseCustomerClusterWorkbook(
  file: File,
): Promise<ParsedCustomerClusterImport> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const arrayBuffer = await file.arrayBuffer();
  await workbook.xlsx.load(arrayBuffer as never);

  const worksheet = selectCustomerClusterWorksheet(workbook.worksheets as WorksheetLike[]);
  if (!worksheet) {
    throw new Error('Nessun foglio leggibile trovato nel file Estrazione.');
  }

  const recordsById = new Map<string, CustomerClusterRecord>();
  let skippedRows = 0;
  let duplicateRows = 0;

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const record = buildCustomerClusterRecord(worksheet, rowNumber);

    if (!record) {
      skippedRows += 1;
      continue;
    }

    if (recordsById.has(record.id)) duplicateRows += 1;
    recordsById.set(record.id, record);
  }

  return {
    fileName: file.name,
    sheetName: worksheet.name,
    rowCount: Math.max(0, worksheet.rowCount - 1),
    skippedRows,
    duplicateRows,
    records: [...recordsById.values()],
  };
}

export async function importCustomerClusters(
  parsed: ParsedCustomerClusterImport,
): Promise<CustomerClusterImportResult> {
  const existingSnapshot = await getDocs(collection(db, 'customer_clusters'));
  const existingById = new Map(
    existingSnapshot.docs.map(item => [
      item.id,
      item.data().sourceFingerprint as string | undefined,
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

  for (const record of parsed.records) {
    const previousFingerprint = existingById.get(record.id);

    if (previousFingerprint === record.sourceFingerprint) {
      unchanged += 1;
      continue;
    }

    batch.set(doc(db, 'customer_clusters', record.id), {
      ...record,
      importedAt: serverTimestamp(),
      ...(previousFingerprint === undefined
        ? { createdAt: serverTimestamp() }
        : {}),
    }, { merge: true });
    batchSize += 1;

    if (previousFingerprint === undefined) created += 1;
    else updated += 1;

    if (batchSize >= 400) await commitBatch();
  }

  await commitBatch();

  const result: CustomerClusterImportResult = {
    created,
    updated,
    unchanged,
    skippedRows: parsed.skippedRows,
    duplicateRows: parsed.duplicateRows,
    totalRows: parsed.rowCount,
    importedRecords: parsed.records.length,
  };

  await addDoc(collection(db, 'import_runs'), {
    importType: 'customerClusters',
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    ...result,
    importedAt: serverTimestamp(),
  });

  return result;
}

export function getCustomerClusterBucket(policyCount: number): CustomerClusterBucket {
  const normalized = Math.floor(policyCount);
  if (normalized > 5) return '>5';
  return String(Math.max(1, normalized)) as CustomerClusterBucket;
}

export function getCustomerClusterStars(policyCount: number): number {
  return Math.min(6, Math.max(1, Math.floor(policyCount)));
}

export function getCustomerClusterRecommendation(policyCount: number): string {
  if (policyCount <= 2) return 'Cliente da sviluppare';
  if (policyCount >= 5) {
    return 'Cliente da curare: pensiamo a un regalo per il cliente, es. una bottiglia di vino';
  }
  return '';
}

function selectCustomerClusterWorksheet(
  worksheets: WorksheetLike[],
): WorksheetLike | undefined {
  if (worksheets.length <= 1) return worksheets[0];

  return worksheets
    .map(worksheet => ({
      worksheet,
      score: getClusterWorksheetScore(worksheet),
    }))
    .sort((first, second) => second.score - first.score)[0]?.worksheet;
}

function getClusterWorksheetScore(worksheet: WorksheetLike): number {
  const headerChecks: Array<[keyof typeof CLUSTER_COLUMNS, string[]]> = [
    ['clientName', ['CONTRAENTE', 'CLIENTE']],
    ['source', ['FONTE']],
    ['quietanzaDate', ['SCAD', 'QUIET']],
    ['policyCount', ['POL']],
    ['annualPremium', ['PREMI']],
    ['agencyCommissions', ['PRV', 'PROVV']],
  ];

  return headerChecks.reduce((score, [columnKey, expectedWords]) => {
    const header = normalizeText(getCellText(
      worksheet,
      1,
      CLUSTER_COLUMNS[columnKey],
    ));
    return score + (expectedWords.some(word => header.includes(word)) ? 1 : 0);
  }, 0);
}

function buildCustomerClusterRecord(
  worksheet: WorksheetLike,
  rowNumber: number,
): CustomerClusterRecord | undefined {
  const clientName = getCellText(worksheet, rowNumber, CLUSTER_COLUMNS.clientName);
  const source = resolveSource(getCellText(worksheet, rowNumber, CLUSTER_COLUMNS.source));
  const policyCount = Math.floor(getCellNumber(
    worksheet,
    rowNumber,
    CLUSTER_COLUMNS.policyCount,
  ));

  if (!clientName || !source.code || policyCount < 1) return undefined;

  const quietanzaDate = getCellDate(worksheet, rowNumber, CLUSTER_COLUMNS.quietanzaDate);
  const birthDate = getCellDate(worksheet, rowNumber, CLUSTER_COLUMNS.birthDate);
  const phone = getCellPhone(worksheet, rowNumber, CLUSTER_COLUMNS.phone);
  const address = getCellText(worksheet, rowNumber, CLUSTER_COLUMNS.address);
  const customerTenure = getCellNumber(
    worksheet,
    rowNumber,
    getCustomerTenureColumn(worksheet),
  );
  const annualPremium = getCellNumber(
    worksheet,
    rowNumber,
    CLUSTER_COLUMNS.annualPremium,
  );
  const agencyCommissions = getCellNumber(
    worksheet,
    rowNumber,
    CLUSTER_COLUMNS.agencyCommissions,
  );
  const identity = [
    'customer-cluster',
    source.code,
    normalizeText(clientName),
    birthDate ? format(birthDate, DATE_FORMAT) : '',
    phone || normalizeText(address),
  ].join('|');
  const baseRecord = {
    id: `customer_cluster_${stableHash(identity)}`,
    clientName,
    sourceCode: source.code,
    sourceName: source.name,
    sourceOwnerEmail: source.ownerEmail,
    sourceOwnerName: source.ownerName,
    quietanzaDate: quietanzaDate ? format(quietanzaDate, DATE_FORMAT) : '',
    birthDate: birthDate ? format(birthDate, DATE_FORMAT) : '',
    address,
    phone,
    customerTenure,
    policyCount,
    policyBucket: getCustomerClusterBucket(policyCount),
    starLevel: getCustomerClusterStars(policyCount),
    annualPremium,
    agencyCommissions,
    recommendation: getCustomerClusterRecommendation(policyCount),
  };

  return {
    ...baseRecord,
    sourceFingerprint: stableHash(JSON.stringify(baseRecord)),
  };
}

function getCustomerTenureColumn(worksheet: WorksheetLike): string {
  const primaryHeader = normalizeText(getCellText(
    worksheet,
    1,
    CLUSTER_COLUMNS.customerTenure,
  ));
  if (primaryHeader.includes('ANZ')) return CLUSTER_COLUMNS.customerTenure;

  const fallbackHeader = normalizeText(getCellText(
    worksheet,
    1,
    CLUSTER_COLUMNS.customerTenureFallback,
  ));
  return fallbackHeader.includes('ANZ')
    ? CLUSTER_COLUMNS.customerTenureFallback
    : CLUSTER_COLUMNS.customerTenure;
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

function getCellNumber(
  worksheet: WorksheetLike,
  rowNumber: number,
  column: string,
): number {
  const cell = worksheet.getCell(rowNumber, columnToNumber(column));

  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return cell.value;
  }

  const text = cell.text.trim();
  if (!text) return 0;

  const cleaned = text
    .replace(/[^\d,.-]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : 0;
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

  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return excelSerialToDate(cell.value);
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

function excelSerialToDate(serial: number): Date | undefined {
  const utcDate = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (!isValid(utcDate)) return undefined;

  return new Date(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
  );
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
