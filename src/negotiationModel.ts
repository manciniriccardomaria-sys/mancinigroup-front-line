import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';

export const NEGOTIATIONS_PILOT_EMAIL = 'manciniriccardo9@gmail.com';
export const PILOT_REPORTS_COLLECTION = 'negotiation_test_reports';
export const NEGOTIATIONS_COLLECTION = 'negotiation_test_deals';
export const NEGOTIATION_CUSTOMERS_COLLECTION = 'negotiation_test_customers';

export function isNegotiationsPilot(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === NEGOTIATIONS_PILOT_EMAIL;
}

// Explicit IDs: deliveries, emissions and calls do not constitute a proposal.
export const PROPOSAL_CATEGORY_IDS = [
  'prevMotorSe', 'prevRetailSe',
  'smeg', 'longevityCare', 'scegliAllianzGen26',
  'contattiFondoPensione', 'contattiProtection', 'contattiEnergia', 'contattiNoleggio',
] as const;

export function isProposalCategory(categoryId: string): boolean {
  return (PROPOSAL_CATEGORY_IDS as readonly string[]).includes(categoryId);
}

export type NegotiationStatus = 'open' | 'ko' | 'ok';
export type CustomerDetails = {
  fiscalCode: string;
  firstName: string;
  lastName: string;
  birthDate: string;
};
export type CustomerMatch = CustomerDetails & {
  needsNameReview: boolean;
  originalName: string;
  notice?: string;
};
export type Negotiation = CustomerDetails & {
  id: string;
  ownerUid: string;
  ownerName: string;
  sourceCode: string;
  sourceName: string;
  categoryId: string;
  proposalLabel: string;
  proposalDate: string;
  status: NegotiationStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function normalizeFiscalCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isValidFiscalCode(value: string): boolean {
  // Includes the omocodia characters used in place of digits.
  return /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(value);
}

export function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && isValid(parseISO(value));
}

export function validateCustomer(customer: CustomerDetails, today: string): string {
  if (!isValidFiscalCode(normalizeFiscalCode(customer.fiscalCode))) return 'Inserisci un codice fiscale di 16 caratteri valido.';
  if (!customer.firstName.trim() || !customer.lastName.trim()) return 'Inserisci nome e cognome del cliente.';
  if (customer.firstName.trim().length > 99 || customer.lastName.trim().length > 99) return 'Nome e cognome devono contenere meno di 100 caratteri.';
  if (!isCalendarDate(customer.birthDate) || customer.birthDate > today) return 'Inserisci una data di nascita valida, non futura.';
  return '';
}

export function daysSinceProposal(proposalDate: string, today: string): number {
  if (!isCalendarDate(proposalDate) || !isCalendarDate(today)) return 0;
  return Math.max(0, differenceInCalendarDays(parseISO(today), parseISO(proposalDate)));
}

export function customerMatchFromRecord(record: Record<string, unknown>): CustomerMatch {
  if (record.hasConflicts === true) return {
    fiscalCode: normalizeFiscalCode(String(record.fiscalCode || '')),
    firstName: '', lastName: '', birthDate: '', needsNameReview: true, originalName: '',
    notice: 'Il CF è presente nell’archivio con anagrafiche discordanti. Verifica il cliente e compila i dati corretti.',
  };
  const originalName = typeof record.clientName === 'string' ? record.clientName.trim() : '';
  const firstName = typeof record.firstName === 'string' ? record.firstName : '';
  const lastName = typeof record.lastName === 'string' ? record.lastName : '';
  // Imported files store "Cognome Nome". Keep the original visible for compound names.
  const parts = originalName.split(/\s+/);
  const hasSeparateNames = Boolean(firstName && lastName);
  return {
    fiscalCode: normalizeFiscalCode(String(record.fiscalCode || '')),
    firstName: hasSeparateNames ? firstName : parts.slice(1).join(' '),
    lastName: hasSeparateNames ? lastName : parts[0] || '',
    birthDate: typeof record.birthDate === 'string' && isCalendarDate(record.birthDate) ? record.birthDate : '',
    needsNameReview: record.needsNameReview === true || !hasSeparateNames,
    originalName,
  };
}

export type NegotiationFilters = {
  search: string;
  source: string;
  categoryId: string;
  status: 'all' | NegotiationStatus;
  dateFrom: string;
  dateTo: string;
  birthDate: string;
  minDays: string;
  maxDays: string;
};

export const EMPTY_NEGOTIATION_FILTERS: NegotiationFilters = {
  search: '', source: '', categoryId: '', status: 'all', dateFrom: '', dateTo: '', birthDate: '', minDays: '', maxDays: '',
};

export function filterNegotiations(items: Negotiation[], filters: NegotiationFilters, today: string): Negotiation[] {
  const search = filters.search.trim().toLocaleLowerCase('it');
  return items.filter(item => {
    const days = daysSinceProposal(item.proposalDate, today);
    return (!search || `${item.firstName} ${item.lastName} ${item.lastName} ${item.firstName} ${item.fiscalCode}`.toLocaleLowerCase('it').includes(search)) &&
      (!filters.source || `${item.sourceCode}|${item.sourceName}` === filters.source) &&
      (!filters.categoryId || item.categoryId === filters.categoryId) &&
      (filters.status === 'all' || item.status === filters.status) &&
      (!filters.dateFrom || item.proposalDate >= filters.dateFrom) &&
      (!filters.dateTo || item.proposalDate <= filters.dateTo) &&
      (!filters.birthDate || item.birthDate === filters.birthDate) &&
      (filters.minDays === '' || days >= Number(filters.minDays)) &&
      (filters.maxDays === '' || days <= Number(filters.maxDays));
  }).sort((a, b) => b.proposalDate.localeCompare(a.proposalDate) || a.lastName.localeCompare(b.lastName, 'it'));
}
