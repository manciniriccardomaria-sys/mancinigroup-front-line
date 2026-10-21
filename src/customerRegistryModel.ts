import { isValid, parse, parseISO, format } from 'date-fns';
import { isValidFiscalCode, normalizeFiscalCode } from './negotiationModel';

export const CUSTOMER_REGISTRY_COLLECTION = 'customer_registry';
export const CUSTOMER_REGISTRY_META_COLLECTION = 'customer_registry_meta';

export type RegistryCandidate = { clientName: string; birthDate: string; sourceRow: number };
export type CustomerRegistryRecord = {
  fiscalCode: string;
  identifierKind: 'person' | 'company';
  clientName: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  needsNameReview: boolean;
  hasConflicts: boolean;
  alternatives: RegistryCandidate[];
  sourceCodes: string[];
  clientStatuses: string[];
  sourceRows: number[];
};
export type RegistrySourceRow = {
  row: number;
  fiscalCode: unknown;
  clientName: string;
  birthDate: unknown;
  firstName?: string;
  lastName?: string;
  sourceCode?: string;
  clientStatus?: string;
};
export type RegistryAnalysis = {
  fileName: string;
  sheetName: string;
  rowCount: number;
  skippedRows: number;
  duplicateRows: number;
  conflicts: number;
  persons: number;
  companies: number;
  missingBirthDates: number;
  namesToReview: number;
  invalidBirthDateRows: number;
  issues: Array<{ row: number; message: string }>;
  records: CustomerRegistryRecord[];
};

export function registryFingerprint(record: CustomerRegistryRecord): string {
  const { fiscalCode, identifierKind, clientName, firstName, lastName, birthDate, needsNameReview, hasConflicts, alternatives, sourceCodes, clientStatuses, sourceRows } = record;
  return JSON.stringify({ fiscalCode, identifierKind, clientName, firstName, lastName, birthDate, needsNameReview, hasConflicts, alternatives, sourceCodes, clientStatuses, sourceRows });
}

const letters = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');

export function normalizeTaxIdentifier(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value < 100_000_000_000) return String(value).padStart(11, '0');
  return normalizeFiscalCode(String(value ?? ''));
}

export function parseRegistryBirthDate(value: unknown, today: string): string {
  if (value === null || value === undefined || value === '') return '';
  let date: Date | undefined;
  if (value instanceof Date) date = value;
  else if (typeof value === 'number' && Number.isFinite(value)) date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
  else {
    const text = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) date = parseISO(text);
    else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)) date = parse(text, 'd/M/yyyy', new Date(2000, 0, 1));
  }
  if (!date || !isValid(date)) return '';
  const result = value instanceof Date || typeof value === 'number'
    ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    : format(date, 'yyyy-MM-dd');
  return result >= '1800-01-01' && result <= today ? result : '';
}

function nameCode(value: string, firstName: boolean): string {
  const text = letters(value);
  let consonants = text.replace(/[AEIOU]/g, '');
  if (firstName && consonants.length >= 4) consonants = consonants[0] + consonants[2] + consonants[3];
  return (consonants + text.replace(/[^AEIOU]/g, '') + 'XXX').slice(0, 3);
}

export function splitRegistryName(clientName: string, fiscalCode: string): { firstName: string; lastName: string; needsNameReview: boolean } {
  const tokens = clientName.trim().split(/\s+/);
  const candidates = new Map<string, { firstName: string; lastName: string }>();
  for (let split = 1; split < tokens.length; split += 1) {
    const before = tokens.slice(0, split).join(' ');
    const after = tokens.slice(split).join(' ');
    for (const [lastName, firstName] of [[before, after], [after, before]]) {
      if (nameCode(lastName, false) === fiscalCode.slice(0, 3) && nameCode(firstName, true) === fiscalCode.slice(3, 6)) {
        candidates.set(`${letters(lastName)}|${letters(firstName)}`, { firstName, lastName });
      }
    }
  }
  if (candidates.size === 1) return { ...[...candidates.values()][0], needsNameReview: false };
  return { firstName: tokens.slice(1).join(' '), lastName: tokens[0] || '', needsNameReview: true };
}

export function analyzeRegistryRows(rows: RegistrySourceRow[], today: string, fileName = '', sheetName = ''): RegistryAnalysis {
  const result: RegistryAnalysis = { fileName, sheetName, rowCount: rows.length, skippedRows: 0, duplicateRows: 0, conflicts: 0, persons: 0, companies: 0, missingBirthDates: 0, namesToReview: 0, invalidBirthDateRows: 0, issues: [], records: [] };
  const byIdentifier = new Map<string, CustomerRegistryRecord>();
  for (const row of rows) {
    const fiscalCode = normalizeTaxIdentifier(row.fiscalCode);
    const person = isValidFiscalCode(fiscalCode);
    const clientName = row.clientName.trim().replace(/\s+/g, ' ');
    if ((!person && !/^\d{11}$/.test(fiscalCode)) || !clientName || clientName.length >= 250) {
      result.skippedRows += 1;
      result.issues.push({ row: row.row, message: !clientName ? 'Nominativo mancante' : 'CF/P.IVA o nominativo non valido' });
      continue;
    }
    const birthDate = parseRegistryBirthDate(row.birthDate, today);
    if (row.birthDate !== null && row.birthDate !== undefined && String(row.birthDate).trim() && !birthDate) {
      result.invalidBirthDateRows += 1;
      result.issues.push({ row: row.row, message: 'Data di nascita non valida: lasciata da completare' });
    }
    const names = !person ? { firstName: '', lastName: '', needsNameReview: false }
      : row.firstName?.trim() && row.lastName?.trim()
        ? { firstName: row.firstName.trim(), lastName: row.lastName.trim(), needsNameReview: false }
        : splitRegistryName(clientName, fiscalCode);
    if (names.firstName.length >= 100 || names.lastName.length >= 100) {
      names.firstName = ''; names.lastName = ''; names.needsNameReview = true;
    }
    const candidate = { clientName, birthDate, sourceRow: row.row };
    const incoming: CustomerRegistryRecord = {
      fiscalCode, identifierKind: person ? 'person' : 'company', clientName, ...names, birthDate,
      hasConflicts: false, alternatives: [candidate],
      sourceCodes: row.sourceCode?.trim() ? [row.sourceCode.trim()] : [],
      clientStatuses: row.clientStatus?.trim() ? [row.clientStatus.trim()] : [], sourceRows: [row.row],
    };
    const existing = byIdentifier.get(fiscalCode);
    if (!existing) { byIdentifier.set(fiscalCode, incoming); continue; }
    result.duplicateRows += 1;
    const identity = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const sameName = identity(existing.clientName) === identity(clientName) ||
      (person && Boolean(existing.firstName && incoming.firstName) && !existing.needsNameReview && !incoming.needsNameReview && letters(existing.firstName) === letters(incoming.firstName) && letters(existing.lastName) === letters(incoming.lastName));
    const incompatibleBirthDate = Boolean(existing.birthDate && birthDate && existing.birthDate !== birthDate);
    existing.hasConflicts ||= !sameName || incompatibleBirthDate;
    existing.alternatives.push(candidate);
    existing.sourceRows.push(row.row);
    existing.sourceCodes = [...new Set([...existing.sourceCodes, ...incoming.sourceCodes])];
    existing.clientStatuses = [...new Set([...existing.clientStatuses, ...incoming.clientStatuses])];
    if (!existing.birthDate) existing.birthDate = birthDate;
  }
  result.records = [...byIdentifier.values()];
  for (const record of result.records) {
    if (record.hasConflicts) {
      result.conflicts += 1;
      record.firstName = ''; record.lastName = ''; record.birthDate = ''; record.needsNameReview = true;
    } else record.alternatives = [];
    if (record.identifierKind === 'company') result.companies += 1;
    else {
      result.persons += 1;
      if (!record.birthDate) result.missingBirthDates += 1;
      if (record.needsNameReview) result.namesToReview += 1;
    }
  }
  return result;
}
