import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, query,
  runTransaction, serverTimestamp, updateDoc, where,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { getAuthorizedEmployee, getReportCategoryValue, type DailyReport } from './constants';
import { getItalyDate } from './lib/utils';
import { SOURCE_DIRECTORY } from './sourceDirectory';
import { CUSTOMER_REGISTRY_COLLECTION } from './customerRegistryModel';
import { PILOT_REPORT_CATEGORIES } from './pilotReportCatalog';
import {
  customerMatchFromRecord, isNegotiationsPilot, isProposalCategory, isValidFiscalCode,
  NEGOTIATIONS_COLLECTION, NEGOTIATION_CUSTOMERS_COLLECTION, normalizeFiscalCode,
  PILOT_REPORTS_COLLECTION, validateCustomer,
  type CustomerDetails, type CustomerMatch, type Negotiation, type NegotiationStatus,
} from './negotiationModel';

function requirePilot() {
  const user = auth.currentUser;
  if (!user || !isNegotiationsPilot(user.email)) throw new Error('Funzione riservata all’account di test.');
  return user;
}

export function createNegotiationId(): string {
  const user = requirePilot();
  return `${user.uid}_${doc(collection(db, NEGOTIATIONS_COLLECTION)).id}`;
}

export async function findNegotiationCustomer(fiscalCode: string): Promise<CustomerMatch | null> {
  const user = requirePilot();
  const normalized = normalizeFiscalCode(fiscalCode);
  if (!isValidFiscalCode(normalized)) return null;
  const saved = await getDoc(doc(db, NEGOTIATION_CUSTOMERS_COLLECTION, `${user.uid}_${normalized}`));
  if (saved.exists()) return customerMatchFromRecord(saved.data());
  const registry = await getDoc(doc(db, CUSTOMER_REGISTRY_COLLECTION, normalized));
  if (registry.exists()) return customerMatchFromRecord(registry.data());

  const snapshots = await Promise.allSettled(['new_clients', 'call_tasks', 'expiration_records'].map(name =>
    getDocs(query(collection(db, name), where('fiscalCode', '==', normalized), limit(10)))
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

export async function saveNegotiation(input: {
  id: string;
  customer: CustomerDetails;
  categoryId: string;
  proposalLabel: string;
  proposalDate: string;
  sourceCode: string;
  sourceName: string;
}): Promise<void> {
  const user = requirePilot();
  const employee = getAuthorizedEmployee(user.email);
  const today = getItalyDate();
  const customer = {
    ...input.customer,
    fiscalCode: normalizeFiscalCode(input.customer.fiscalCode),
    firstName: input.customer.firstName.trim(),
    lastName: input.customer.lastName.trim(),
  };
  const validation = validateCustomer(customer, today);
  if (validation) throw new Error(validation);
  if (input.proposalDate !== today) throw new Error('È cambiata la giornata. Riapri la proposta per aggiornare la data.');
  if (!isProposalCategory(input.categoryId)) throw new Error('Questa attività non prevede una proposta.');
  if (!employee?.sourceCodes.includes(input.sourceCode) || !SOURCE_DIRECTORY.some(source => source.code === input.sourceCode && source.name === input.sourceName)) {
    throw new Error('Seleziona una fonte assegnata al tuo account.');
  }
  const dealRef = doc(db, NEGOTIATIONS_COLLECTION, input.id);
  const reportRef = doc(db, PILOT_REPORTS_COLLECTION, `${user.uid}_${today}`);
  const customerRef = doc(db, NEGOTIATION_CUSTOMERS_COLLECTION, `${user.uid}_${customer.fiscalCode}`);

  // A single commit links the proposal, customer and counter. A retry uses the same ID.
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
      proposalLabel: input.proposalLabel,
      proposalDate: today,
      status: 'open',
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
  const user = requirePilot();
  return onSnapshot(query(collection(db, NEGOTIATIONS_COLLECTION), where('ownerUid', '==', user.uid)), snapshot => {
    onData(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as Negotiation)));
  }, onError);
}

export async function adjustPilotReportCount(categoryId: string, delta: number): Promise<void> {
  const user = requirePilot();
  if (isProposalCategory(categoryId) || !PILOT_REPORT_CATEGORIES.some(category => category.id === categoryId) || ![1, -1].includes(delta)) {
    throw new Error('Voce non modificabile manualmente. Le proposte si registrano tramite la scheda cliente.');
  }
  const today = getItalyDate();
  const reportRef = doc(db, PILOT_REPORTS_COLLECTION, `${user.uid}_${today}`);
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reportRef);
    const report = snapshot.exists() ? snapshot.data() as Partial<DailyReport> : {};
    transaction.set(reportRef, {
      userId: user.uid,
      userName: getAuthorizedEmployee(user.email)!.name,
      date: today,
      values: { ...(report.values || {}), [categoryId]: Math.max(0, getReportCategoryValue(report, categoryId) + delta) },
    }, { merge: true });
  });
}

export async function setNegotiationStatus(id: string, status: NegotiationStatus): Promise<void> {
  requirePilot();
  await updateDoc(doc(db, NEGOTIATIONS_COLLECTION, id), { status, updatedAt: serverTimestamp() });
}

export function getNegotiationErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('permission-denied')) return 'Accesso ai dati di test negato. Verifica che le regole Firestore aggiornate siano pubblicate sul database dell’app.';
  if (code.includes('unavailable')) return 'Database non raggiungibile. Controlla la connessione e riprova.';
  return error instanceof Error ? error.message : 'Operazione non riuscita. Riprova.';
}
