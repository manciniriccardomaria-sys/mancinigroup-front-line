import { collection, doc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getAuthorizedAgent } from './constants';
import {
  CUSTOMER_REGISTRY_COLLECTION, CUSTOMER_REGISTRY_META_COLLECTION, registryFingerprint,
  type RegistryAnalysis,
} from './customerRegistryModel';

export type RegistryImportResult = { created: number; updated: number; unchanged: number; totalArchiveRecords: number };
export type RegistryImportSummary = RegistryImportResult & Omit<RegistryAnalysis, 'records' | 'issues'> & { uniqueRecords: number; importedAt?: unknown; importedBy: string };

export async function importCustomerRegistry(analysis: RegistryAnalysis, onProgress: (done: number, total: number) => void): Promise<RegistryImportResult> {
  const user = auth.currentUser;
  if (!user || !getAuthorizedAgent(user.email)) throw new Error('Solo gli amministratori possono aggiornare l’anagrafica clienti.');
  const previous = await getDocs(collection(db, CUSTOMER_REGISTRY_COLLECTION));
  const fingerprints = new Map(previous.docs.map(item => [item.id, String(item.data().sourceFingerprint || '')]));
  const result: RegistryImportResult = { created: 0, updated: 0, unchanged: 0, totalArchiveRecords: fingerprints.size };
  const changed = analysis.records.filter(record => {
    const oldFingerprint = fingerprints.get(record.fiscalCode);
    if (oldFingerprint === registryFingerprint(record)) { result.unchanged += 1; return false; }
    if (oldFingerprint === undefined) { result.created += 1; result.totalArchiveRecords += 1; }
    else result.updated += 1;
    return true;
  });
  let saved = 0;
  onProgress(0, changed.length);
  try {
    for (let offset = 0; offset < changed.length; offset += 400) {
      const batch = writeBatch(db);
      const group = changed.slice(offset, offset + 400);
      for (const record of group) batch.set(doc(db, CUSTOMER_REGISTRY_COLLECTION, record.fiscalCode), {
        ...record, sourceFingerprint: registryFingerprint(record), sourceFileName: analysis.fileName,
        importedAt: serverTimestamp(), importedBy: user.email,
      });
      await batch.commit();
      saved += group.length;
      onProgress(saved, changed.length);
    }
    const { records, issues, ...summary } = analysis;
    await setDoc(doc(db, CUSTOMER_REGISTRY_META_COLLECTION, 'current'), {
      ...summary, ...result, uniqueRecords: records.length,
      importedAt: serverTimestamp(), importedBy: user.email,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Database non disponibile';
    throw new Error(`Importazione non completata: ${saved} anagrafiche salvate. Puoi ricaricare lo stesso file senza creare duplicati. ${reason}`);
  }
  return result;
}
