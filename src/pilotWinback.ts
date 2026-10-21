import { collection, doc, onSnapshot, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getItalyDate } from './lib/utils';
import { isNegotiationsPilot } from './negotiationModel';
import { PILOT_WINBACK_COLLECTION, WINBACK_OUTCOMES, type PilotWinbackCall, type WinbackOutcome } from './pilotWinbackModel';

function requirePilot() {
  const user = auth.currentUser;
  if (!user || !isNegotiationsPilot(user.email)) throw new Error('Registro riservato al profilo di test di Riccardo.');
  return user;
}

function validateOutcome(outcome: WinbackOutcome) {
  if (!WINBACK_OUTCOMES.some(option => option.id === outcome)) throw new Error('Seleziona un esito valido.');
}

export function createWinbackCallId() {
  const user = requirePilot();
  return `${user.uid}_${doc(collection(db, PILOT_WINBACK_COLLECTION)).id}`;
}

export function subscribeToPilotWinbackCalls(onData: (calls: PilotWinbackCall[]) => void, onError: (error: unknown) => void) {
  const user = requirePilot();
  return onSnapshot(query(collection(db, PILOT_WINBACK_COLLECTION), where('ownerUid', '==', user.uid)), snapshot => {
    onData(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as PilotWinbackCall)));
  }, onError);
}

export async function recordPilotWinbackCall(id: string, taskId: string, outcome: WinbackOutcome) {
  const user = requirePilot();
  validateOutcome(outcome);
  if (!id.startsWith(`${user.uid}_`) || !taskId || taskId.includes('/')) throw new Error('Chiamata non valida.');
  await runTransaction(db, async transaction => {
    const ref = doc(db, PILOT_WINBACK_COLLECTION, id);
    if ((await transaction.get(ref)).exists()) return;
    const snapshot = await transaction.get(doc(db, 'call_tasks', taskId));
    const task = snapshot.data();
    if (!snapshot.exists() || task.category !== 'winback' || (task.sourceCode !== '098' && task.assignedToUid !== user.uid)) {
      throw new Error('Seleziona una chiamata Winback delle tue fonti o assegnata a te.');
    }
    transaction.set(ref, {
      ownerUid: user.uid, taskId, clientName: task.clientName,
      customerKey: task.fiscalCode || `${task.sourceCode}|${task.clientName}`,
      sourceCode: task.sourceCode, sourceName: task.sourceName,
      calledDate: getItalyDate(), outcome,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    });
  });
}

export async function correctPilotWinbackOutcome(id: string, outcome: WinbackOutcome) {
  const user = requirePilot();
  validateOutcome(outcome);
  if (!id.startsWith(`${user.uid}_`)) throw new Error('Chiamata non valida.');
  await updateDoc(doc(db, PILOT_WINBACK_COLLECTION, id), { outcome, updatedAt: serverTimestamp() });
}
