import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, query,
  runTransaction, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { DAILY_REPORTS_COLLECTION, getAuthorizedEmployee, getReportCategoryValue, type DailyReport } from './constants';
import { getItalyDate } from './lib/utils';
import { SOURCE_DIRECTORY } from './sourceDirectory';
import { CUSTOMER_REGISTRY_COLLECTION } from './customerRegistryModel';
import { PILOT_REPORT_CATEGORIES } from './pilotReportCatalog';
import {
  customerMatchFromRecord, hasNegotiationsAccess, isCustomerActivityCategory, isProposalCategory, isValidFiscalCode,
  NEGOTIATIONS_COLLECTION, NEGOTIATION_CUSTOMERS_COLLECTION, normalizeFiscalCode,
  VITARIV_DELIVERIES_COLLECTION, validateCustomer,
  type CustomerDetails, type CustomerMatch, type Negotiation, type NegotiationStatus,
} from './negotiationModel';

function requireNegotiationsUser() {
  const user = auth.currentUser;
  const employee = getAuthorizedEmployee(user?.email);
  if (!user || !employee || !hasNegotiationsAccess(user.email)) throw new Error('Funzione riservata ai profili abilitati.');
  return { user, employee };
}

export function createNegotiationId(): string {
  const { user } = requireNegotiationsUser();
  return `${user.uid}_${doc(collection(db, NEGOTIATIONS_COLLECTION)).id}`;
}

export async function findNegotiationCustomer(fiscalCode: string): Promise<CustomerMatch | null> {
  const { user, employee } = requireNegotiationsUser();
  const normalized = normalizeFiscalCode(fiscalCode);
  if (!isValidFiscalCode(normalized)) return null;
  const saved = await getDoc(doc(db, NEGOTIATION_CUSTOMERS_COLLECTION, `${user.uid}_${normalized}`));
  if (saved.exists()) return customerMatchFromRecord(saved.data());
  try {
    const registry = await getDoc(doc(db, CUSTOMER_REGISTRY_COLLECTION, normalized));
    if (registry.exists()) return customerMatchFromRecord(registry.data());
  } catch (error) {
    // A source-scoped registry lookup can be denied for an unknown or out-of-source CF.
    if (errorCode(error) !== 'permission-denied') throw error;
  }

  const sourceFilter = where('sourceCode', 'in', employee.sourceCodes);
  const snapshots = await Promise.allSettled(['new_clients', 'call_tasks', 'expiration_records'].map(name =>
    getDocs(query(collection(db, name), where('fiscalCode', '==', normalized), sourceFilter, limit(10)))
  ));
  const matches = snapshots.flatMap(result => result.status === 'fulfilled' ? result.value.docs.map(item => customerMatchFromRecord(item.data())) : []);
  if (matches.length === 0) {
    const failed = snapshots.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return null;
  }
  const preferred = matches.find(match => match.birthDate) || matches[0];
  return {
    ...preferred,
    firstName: preferred.firstName || matches.find(match => match.firstName)?.firstName || '',
    lastName: preferred.lastName || matches.find(match => match.lastName)?.lastName || '',
  };
}

type CustomerActivityInput = {
  id: string;
  customer: CustomerDetails;
  categoryId: string;
  proposalLabel: string;
  proposalDate: string;
  sourceCode: string;
  sourceName: string;
};

export async function saveNegotiation(input: CustomerActivityInput): Promise<void> {
  if (!isProposalCategory(input.categoryId)) throw new Error('Questa attività non prevede una proposta.');
  await saveCustomerActivity(input, false);
}

export async function saveVitarivDelivery(input: CustomerActivityInput): Promise<void> {
  if (input.categoryId !== 'vitarivConsegna') throw new Error('Seleziona la consegna Vitariv.');
  await saveCustomerActivity(input, true);
}

async function saveCustomerActivity(input: CustomerActivityInput, delivery: boolean): Promise<void> {
  const { user, employee } = requireNegotiationsUser();
  const today = getItalyDate();
  const customer = {
    ...input.customer,
    fiscalCode: normalizeFiscalCode(input.customer.fiscalCode),
    firstName: input.customer.firstName.trim(),
    lastName: input.customer.lastName.trim(),
  };
  const validation = validateCustomer(customer, today);
  if (validation) throw new Error(validation);
  if (input.proposalDate !== today) throw new Error('È cambiata la giornata. Riapri la scheda cliente per aggiornare la data.');
  if (!employee.sourceCodes.includes(input.sourceCode) || !SOURCE_DIRECTORY.some(source => source.code === input.sourceCode && source.name === input.sourceName)) {
    throw new Error('Seleziona una fonte assegnata al tuo account.');
  }
  const dealRef = doc(db, delivery ? VITARIV_DELIVERIES_COLLECTION : NEGOTIATIONS_COLLECTION, input.id);
  const reportRef = doc(db, DAILY_REPORTS_COLLECTION, `${user.uid}_${today}`);
  const customerRef = doc(db, NEGOTIATION_CUSTOMERS_COLLECTION, `${user.uid}_${customer.fiscalCode}`);

  // A single commit links the activity, customer and counter. A retry uses the same ID.
  await runTransaction(db, async transaction => {
    const existingDeal = await transaction.get(dealRef);
    if (existingDeal.exists()) return;
    const reportSnapshot = await transaction.get(reportRef);
    const report = reportSnapshot.exists() ? reportSnapshot.data() as Partial<DailyReport> : {};
    transaction.set(dealRef, {
      ...customer,
      ownerUid: user.uid,
      ownerName: employee.name,
      sourceCode: input.sourceCode,
      sourceName: input.sourceName,
      categoryId: input.categoryId,
      ...(delivery
        ? { activityLabel: input.proposalLabel, activityDate: today }
        : { proposalLabel: input.proposalLabel, proposalDate: today, status: 'open' }),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(customerRef, { ...customer, ownerUid: user.uid, updatedAt: serverTimestamp() });
    transaction.set(reportRef, {
      userId: user.uid,
      userName: employee.name,
      date: today,
      values: {
        ...(report.values || {}),
        [input.categoryId]: getReportCategoryValue(report, input.categoryId) + 1,
      },
    }, { merge: true });
  });
}

export function subscribeToNegotiations(onData: (items: Negotiation[]) => void, onError: (error: unknown) => void) {
  const { user } = requireNegotiationsUser();
  return onSnapshot(query(collection(db, NEGOTIATIONS_COLLECTION), where('ownerUid', '==', user.uid)), snapshot => {
    onData(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as Negotiation)));
  }, onError);
}

export async function adjustDetailedReportCount(categoryId: string, delta: number): Promise<void> {
  const { user, employee } = requireNegotiationsUser();
  if (isCustomerActivityCategory(categoryId) || !PILOT_REPORT_CATEGORIES.some(category => category.id === categoryId) || ![1, -1].includes(delta)) {
    throw new Error('Voce non modificabile manualmente. Registra l’attività tramite la scheda cliente.');
  }
  const today = getItalyDate();
  const reportRef = doc(db, DAILY_REPORTS_COLLECTION, `${user.uid}_${today}`);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reportRef);
    const report = snapshot.exists() ? snapshot.data() as Partial<DailyReport> : {};
    transaction.set(reportRef, {
      userId: user.uid,
      userName: employee.name,
      date: today,
      values: { ...(report.values || {}), [categoryId]: Math.max(0, getReportCategoryValue(report, categoryId) + delta) },
    }, { merge: true });
  });
}

export async function setNegotiationStatus(id: string, status: NegotiationStatus): Promise<void> {
  requireNegotiationsUser();
  await updateDoc(doc(db, NEGOTIATIONS_COLLECTION, id), { status, updatedAt: serverTimestamp() });
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
}

export function getNegotiationErrorMessage(error: unknown): string {
  const code = errorCode(error);
  if (code.includes('permission-denied')) return 'Accesso ai dati non consentito per questo profilo.';
  if (code.includes('unavailable')) return 'Database non raggiungibile. Controlla la connessione e riprova.';
  return error instanceof Error ? error.message : 'Operazione non riuscita. Riprova.';
}
