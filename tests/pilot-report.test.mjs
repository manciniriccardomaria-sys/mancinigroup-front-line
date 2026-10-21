import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function load(entryPoint, plugins = []) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const catalog = await load('src/pilotReportCatalog.ts');
const model = await load('src/negotiationModel.ts');
const calls = await load('src/pilotWinbackModel.ts');
const { getItalyDate } = await load('src/lib/utils.ts');

test('the pilot has exactly four sections, unique counters and all agreed product variants', () => {
  assert.deepEqual(catalog.PILOT_REPORT_SECTIONS.map(section => section.title), ['Ricezione', 'Promozione', 'Emissione', 'Terzi']);
  const ids = catalog.PILOT_REPORT_CATEGORIES.map(category => category.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.length, 29);
  for (const retired of ['prevRetailSe', 'emissRetailSe', 'prevRetailTerzi', 'winbackMag25']) assert.equal(ids.includes(retired), false);
  const promotion = catalog.PILOT_REPORT_SECTIONS[1].categories.map(category => category.id);
  for (const id of ['vitarivConsegna', 'scegliAllianzConsegna', 'recensioni']) assert.equal(promotion.includes(id), true);
  for (const section of catalog.PILOT_REPORT_SECTIONS.slice(1)) {
    assert.deepEqual(section.categories.slice(0, 5).map(category => category.label), ['Motor', 'ULTRA Salute', 'SMEG', 'ULTRA Casa', 'ULTRA Impresa']);
  }
  for (const id of ['prevUltraSalute', 'prevUltraCasa', 'prevUltraImpresa', 'smeg']) assert.equal(model.isProposalCategory(id), true);
  for (const id of ['emissUltraSalute', 'prevUltraCasaTerzi', 'prevSmegTerzi']) assert.equal(model.isProposalCategory(id), false);
});

test('old Retail and manual Winback values remain separate without inventing product allocations', () => {
  const report = { values: { prevRetailSe: 5, winbackMag25: 3, prevUltraCasa: 2 }, emissRetailSe: 1 };
  assert.deepEqual(catalog.getRetiredPilotActivities(report).map(({ category, value }) => [category.id, value]), [['prevRetailSe', 5], ['emissRetailSe', 1], ['winbackMag25', 3]]);
  assert.equal(report.values.prevUltraCasa, 2);
});

const event = { id: 'pilot_1', ownerUid: 'pilot', taskId: 'task1', customerKey: 'customer1', calledDate: '2026-10-21', outcome: 'reached' };
test('Winback counts actual events by operator and Italian date and unique customers across multiple policies', () => {
  assert.deepEqual(calls.summarizeWinbackCalls([
    event, event,
    { ...event, id: 'pilot_2', taskId: 'policy2', outcome: 'recovered' },
    { ...event, id: 'pilot_3', customerKey: 'customer2', outcome: 'not_reached' },
    { ...event, id: 'other_4', ownerUid: 'other' },
    { ...event, id: 'pilot_yesterday', calledDate: '2026-10-20' },
  ], 'pilot', '2026-10-21'), { calls: 3, reached: 1, recovered: 1 });
  assert.deepEqual(calls.summarizeWinbackCalls([{ ...event, outcome: 'recovered' }], 'pilot', '2026-10-21'), { calls: 1, reached: 1, recovered: 1 });
  assert.deepEqual(calls.summarizeWinbackCalls([], 'pilot', '2026-10-21'), { calls: 0, reached: 0, recovered: 0 });
});

const mock = { name: 'pilot-winback-firestore', setup(builder) {
  builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'mock' }));
  builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'mock' }));
  builder.onLoad({ filter: /^firebase$/, namespace: 'mock' }, () => ({ contents: 'export const db = {}; export const auth = { get currentUser() { return globalThis.pilotCallUser; } };' }));
  builder.onLoad({ filter: /^firestore$/, namespace: 'mock' }, () => ({ contents: `
    export const collection = (db, name) => name;
    export const doc = (db, name, id) => typeof db === 'string' ? { name: db, id: 'generated' } : { name, id };
    export const where = (...args) => args;
    export const query = (...args) => args;
    export const onSnapshot = () => () => {};
    export const serverTimestamp = () => 'server-time';
    const key = ref => ref.name + '/' + ref.id;
    export const updateDoc = async (ref, data) => {
      globalThis.pilotCallWrites.push({ ref, data });
      globalThis.pilotCallStore[key(ref)] = { ...globalThis.pilotCallStore[key(ref)], ...data };
    };
    export const runTransaction = async (db, callback) => {
      const staged = [];
      await callback({
        get: async ref => ({ exists: () => key(ref) in globalThis.pilotCallStore, data: () => globalThis.pilotCallStore[key(ref)] }),
        set: (ref, data) => staged.push({ ref, data }),
      });
      if (globalThis.failPilotCallCommit) throw new Error('offline');
      for (const write of staged) { globalThis.pilotCallStore[key(write.ref)] = write.data; globalThis.pilotCallWrites.push(write); }
    };
  ` }));
} };
const service = await load('src/pilotWinback.ts', [mock]);
function reset() {
  globalThis.pilotCallUser = { uid: 'pilot', email: model.NEGOTIATIONS_PILOT_EMAIL };
  globalThis.pilotCallStore = { 'call_tasks/task1': { category: 'winback', sourceCode: '098', sourceName: 'TEST', clientName: 'CLIENTE DEMO', fiscalCode: 'DEMO-CUSTOMER' } };
  globalThis.pilotCallWrites = [];
  globalThis.failPilotCallCommit = false;
}

test('Winback retry is idempotent, writes only the pilot event and never mutates an operational call', async () => {
  reset();
  const task = { ...globalThis.pilotCallStore['call_tasks/task1'] };
  await service.recordPilotWinbackCall('pilot_event', 'task1', 'reached');
  await service.recordPilotWinbackCall('pilot_event', 'task1', 'reached');
  assert.equal(globalThis.pilotCallWrites.length, 1);
  assert.equal(globalThis.pilotCallWrites[0].ref.name, calls.PILOT_WINBACK_COLLECTION);
  assert.equal(globalThis.pilotCallWrites[0].data.calledDate, getItalyDate());
  assert.equal(globalThis.pilotCallWrites[0].data.customerKey, task.fiscalCode);
  assert.deepEqual(globalThis.pilotCallStore['call_tasks/task1'], task);
  await service.correctPilotWinbackOutcome('pilot_event', 'recovered');
  assert.deepEqual(globalThis.pilotCallWrites[1].data, { outcome: 'recovered', updatedAt: 'server-time' });
  const saved = globalThis.pilotCallStore['pilot_winback_calls/pilot_event'];
  assert.deepEqual(calls.summarizeWinbackCalls([{ ...saved, id: 'pilot_event' }], 'pilot', getItalyDate()), { calls: 1, reached: 1, recovered: 1 });
});

test('a failed Winback commit leaves no event and a retry can complete safely', async () => {
  reset(); globalThis.failPilotCallCommit = true;
  await assert.rejects(service.recordPilotWinbackCall('pilot_event', 'task1', 'reached'), /offline/);
  assert.equal(globalThis.pilotCallWrites.length, 0);
  globalThis.failPilotCallCommit = false;
  await service.recordPilotWinbackCall('pilot_event', 'task1', 'reached');
  assert.equal(globalThis.pilotCallWrites.length, 1);
});

test('non-pilot users, invalid outcomes and calls outside the pilot ownership cannot be recorded', async () => {
  reset();
  for (const args of [['other_event', 'task1', 'reached'], ['pilot_event', 'task1', 'invented'], ['pilot_event', 'missing', 'reached']]) await assert.rejects(service.recordPilotWinbackCall(...args));
  globalThis.pilotCallStore['call_tasks/task1'].sourceCode = '005';
  await assert.rejects(service.recordPilotWinbackCall('pilot_event', 'task1', 'reached'));
  globalThis.pilotCallStore['call_tasks/task1'].assignedToUid = 'pilot';
  await service.recordPilotWinbackCall('pilot_event', 'task1', 'reached');
  assert.equal(globalThis.pilotCallWrites.length, 1);
  globalThis.pilotCallUser.email = 'b.marinamancinigroup@gmail.com';
  await assert.rejects(service.recordPilotWinbackCall('pilot_other', 'task1', 'reached'), /riservato/);
  await assert.rejects(service.correctPilotWinbackOutcome('pilot_event', 'not_reached'), /riservato/);
});
