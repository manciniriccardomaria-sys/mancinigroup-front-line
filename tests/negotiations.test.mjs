import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function loadModule(entryPoint, plugins = []) {
  const result = await build({ entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const model = await loadModule('src/negotiationModel.ts');
const customer = { fiscalCode: 'RSSMRA80A01H501U', firstName: 'Mario', lastName: 'Rossi', birthDate: '1980-01-01' };

test('only the designated test account enables proposals', () => {
  assert.equal(model.isNegotiationsPilot(' MANCINIRICCARDO9@gmail.com '), true);
  for (const email of ['manciniriccardomaria@gmail.com', 'b.marinamancinigroup@gmail.com', null, '']) assert.equal(model.isNegotiationsPilot(email), false);
  for (const category of ['prevMotorTerzi', 'prevRetailTerzi', 'incassi', 'emissMotorSe', 'scegliAllianzConsegna', 'vitarivConsegna', 'winbackMag25', 'unknown']) assert.equal(model.isProposalCategory(category), false);
});

test('customer validation rejects missing data, malformed CF and impossible or future birthdays', () => {
  assert.equal(model.validateCustomer(customer, '2026-10-20'), '');
  for (const changes of [{ fiscalCode: '123' }, { firstName: ' ' }, { lastName: '' }, { birthDate: '2026-02-30' }, { birthDate: '2026-10-21' }]) assert.notEqual(model.validateCustomer({ ...customer, ...changes }, '2026-10-20'), '');
  assert.equal(model.normalizeFiscalCode(' rssmra80a01h501u '), customer.fiscalCode);
});

test('elapsed calendar days handle DST, leap years, today and future dates', () => {
  assert.equal(model.daysSinceProposal('2026-10-24', '2026-10-26'), 2);
  assert.equal(model.daysSinceProposal('2026-03-28', '2026-03-30'), 2);
  assert.equal(model.daysSinceProposal('2024-02-28', '2024-03-01'), 2);
  assert.equal(model.daysSinceProposal('2026-10-20', '2026-10-20'), 0);
  assert.equal(model.daysSinceProposal('2026-10-21', '2026-10-20'), 0);
});

test('imported compound names require review; previously entered separate names remain intact', () => {
  const imported = model.customerMatchFromRecord({ fiscalCode: customer.fiscalCode, clientName: 'DE ROSSI MARIO', birthDate: '1980-01-01' });
  assert.equal(imported.needsNameReview, true);
  assert.equal(imported.originalName, 'DE ROSSI MARIO');
  const saved = model.customerMatchFromRecord({ ...customer, lastName: 'De Rossi' });
  assert.equal(saved.needsNameReview, false);
  assert.equal(saved.lastName, 'De Rossi');
});

test('filters combine customer, exact source pair, proposal, birth date, period, status and elapsed days', () => {
  const deal = { ...customer, id: 'a', sourceCode: '000', sourceName: 'MOLFETTA UMBERTO', categoryId: 'smeg', proposalDate: '2026-10-10', status: 'ok' };
  const filters = { ...model.EMPTY_NEGOTIATION_FILTERS, search: 'rossi mario', source: '000|MOLFETTA UMBERTO', categoryId: 'smeg', status: 'ok', dateFrom: '2026-10-10', dateTo: '2026-10-10', birthDate: customer.birthDate, minDays: '10', maxDays: '10' };
  assert.deepEqual(model.filterNegotiations([deal, { ...deal, id: 'b', sourceName: "DIRETTA D'AGENZIA" }], filters, '2026-10-20').map(item => item.id), ['a']);
  assert.equal(model.filterNegotiations([deal], { ...filters, minDays: '11' }, '2026-10-20').length, 0);
});

const firestoreMock = {
  name: 'negotiation-firestore',
  setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'mock' }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'firebase', namespace: 'mock' }));
    builder.onLoad({ filter: /^firebase$/, namespace: 'mock' }, () => ({ contents: 'export const db = {}; export const auth = { get currentUser() { return globalThis.negotiationUser; } };' }));
    builder.onLoad({ filter: /^firestore$/, namespace: 'mock' }, () => ({ contents: `
      export const collection = (db, name) => name;
      export const doc = (db, name, id) => typeof db === 'string' ? { name: db, id: 'generated' } : { name, id };
      export const query = (name, ...filters) => ({ name, filters });
      export const where = (...args) => args;
      export const limit = value => ['limit', value];
      export const serverTimestamp = () => 'server-time';
      const key = ref => ref.name + '/' + ref.id;
      const snap = value => ({ exists: () => value !== undefined, data: () => value });
      export const getDoc = async ref => snap(globalThis.negotiationStore[key(ref)]);
      export const getDocs = async q => {
        globalThis.negotiationReads.push(q);
        if (globalThis.negotiationReadFailures?.includes(q.name)) throw new Error('archive unavailable');
        return { docs: (globalThis.importedCustomers[q.name] || []).map(data => ({ data: () => data })) };
      };
      export const onSnapshot = () => () => {};
      export const updateDoc = async (ref, data) => globalThis.negotiationWrites.push({ ref, data });
      export const runTransaction = async (db, callback) => {
        const staged = [];
        await callback({ get: getDoc, set: (ref, data, options) => staged.push({ ref, data, options }) });
        if (globalThis.failNegotiationCommit) throw new Error('simulated offline failure');
        for (const write of staged) globalThis.negotiationStore[key(write.ref)] = { ...(globalThis.negotiationStore[key(write.ref)] || {}), ...write.data };
        globalThis.negotiationWrites.push(...staged);
      };
    ` }));
  },
};
const service = await loadModule('src/negotiations.ts', [firestoreMock]);
const { getItalyDate } = await loadModule('src/lib/utils.ts');
function reset() {
  globalThis.negotiationUser = { uid: 'pilot', email: model.NEGOTIATIONS_PILOT_EMAIL };
  globalThis.negotiationStore = {};
  globalThis.negotiationWrites = [];
  globalThis.negotiationReads = [];
  globalThis.importedCustomers = {};
  globalThis.negotiationReadFailures = [];
  globalThis.failNegotiationCommit = false;
}
const proposal = () => ({ id: 'pilot_deal-1', customer, categoryId: 'smeg', proposalLabel: 'SMEG', proposalDate: getItalyDate(), sourceCode: '098', sourceName: 'MANCINI RICCARDO MARIA' });

test('saving is atomic, isolated from production and idempotent on retry', async () => {
  reset();
  globalThis.negotiationStore['negotiation_test_reports/pilot_' + getItalyDate()] = { values: { smeg: 4, incassi: 3 } };
  await service.saveNegotiation(proposal());
  assert.deepEqual(globalThis.negotiationWrites.map(write => write.ref.name), ['negotiation_test_deals', 'negotiation_test_customers', 'negotiation_test_reports']);
  assert.deepEqual(globalThis.negotiationWrites[2].data.values, { smeg: 5, incassi: 3 });
  assert.equal(globalThis.negotiationWrites[0].data.status, 'open');
  await service.saveNegotiation(proposal());
  assert.equal(globalThis.negotiationWrites.length, 3);
});

test('a failed commit leaves no customer, deal or report increments', async () => {
  reset(); globalThis.failNegotiationCommit = true;
  await assert.rejects(service.saveNegotiation(proposal()), /offline/);
  assert.deepEqual(globalThis.negotiationStore, {});
  assert.deepEqual(globalThis.negotiationWrites, []);
});

test('other pilot counters preserve proposal counts and never become negative', async () => {
  reset();
  await service.saveNegotiation(proposal());
  await service.adjustPilotReportCount('incassi', 1);
  assert.deepEqual(globalThis.negotiationStore['negotiation_test_reports/pilot_' + getItalyDate()].values, { smeg: 1, incassi: 1 });
  await service.adjustPilotReportCount('incassi', -1);
  await service.adjustPilotReportCount('incassi', -1);
  assert.deepEqual(globalThis.negotiationStore['negotiation_test_reports/pilot_' + getItalyDate()].values, { smeg: 1, incassi: 0 });
  await assert.rejects(service.adjustPilotReportCount('smeg', -1));
});

test('invalid source, date, category or non-pilot session cannot write', async () => {
  reset();
  for (const changes of [{ sourceCode: '005' }, { sourceName: 'wrong' }, { categoryId: 'incassi' }, { proposalDate: '2000-01-01' }]) await assert.rejects(service.saveNegotiation({ ...proposal(), ...changes }));
  globalThis.negotiationUser.email = 'manciniriccardomaria@gmail.com';
  await assert.rejects(service.saveNegotiation(proposal()), /riservata/);
  assert.deepEqual(globalThis.negotiationWrites, []);
});

test('lookup uses saved separate names first and otherwise finds imported clients with birth dates', async () => {
  reset();
  globalThis.negotiationStore['negotiation_test_customers/pilot_' + customer.fiscalCode] = customer;
  assert.equal((await service.findNegotiationCustomer(customer.fiscalCode)).firstName, 'Mario');
  assert.equal(globalThis.negotiationReads.length, 0);
  globalThis.negotiationStore = {};
  globalThis.importedCustomers = { call_tasks: [{ fiscalCode: customer.fiscalCode, clientName: 'ROSSI MARIO', birthDate: customer.birthDate }] };
  assert.equal((await service.findNegotiationCustomer(customer.fiscalCode)).birthDate, customer.birthDate);
  assert.equal(globalThis.negotiationReads.length, 3);
  globalThis.importedCustomers = {};
  assert.equal(await service.findNegotiationCustomer(customer.fiscalCode), null);
});

test('OK/KO updates the outcome without changing proposal dates or counters', async () => {
  reset();
  await service.setNegotiationStatus('pilot_deal-1', 'ok');
  assert.deepEqual(globalThis.negotiationWrites, [{ ref: { name: 'negotiation_test_deals', id: 'pilot_deal-1' }, data: { status: 'ok', updatedAt: 'server-time' } }]);
});

test('the master registry supplies compound names directly without scanning campaign archives', async () => {
  reset();
  globalThis.negotiationStore['customer_registry/' + customer.fiscalCode] = { ...customer, lastName: 'De Rossi', clientName: 'DE ROSSI MARIO', needsNameReview: false };
  const found = await service.findNegotiationCustomer(customer.fiscalCode);
  assert.equal(found.lastName, 'De Rossi'); assert.equal(found.needsNameReview, false);
  assert.equal(globalThis.negotiationReads.length, 0);
  globalThis.negotiationStore['customer_registry/' + customer.fiscalCode].hasConflicts = true;
  const conflict = await service.findNegotiationCustomer(customer.fiscalCode);
  assert.equal(conflict.firstName, ''); assert.equal(conflict.birthDate, ''); assert.match(conflict.notice, /discordanti/);
});

test('a failed legacy archive cannot hide a client found in another archive', async () => {
  reset(); globalThis.negotiationReadFailures = ['new_clients'];
  globalThis.importedCustomers = { call_tasks: [{ ...customer, clientName: 'ROSSI MARIO' }] };
  assert.equal((await service.findNegotiationCustomer(customer.fiscalCode)).firstName, 'Mario');
  globalThis.importedCustomers = {};
  await assert.rejects(service.findNegotiationCustomer(customer.fiscalCode), /archive unavailable/);
});
