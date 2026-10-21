import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function loadModule(entryPoint, plugins = []) {
  const bundle = await build({ entryPoints: [entryPoint], bundle: true, write: false, platform: 'node', format: 'esm', plugins });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}
const model = await loadModule('src/customerRegistryModel.ts');
const today = '2026-10-21';
const row = { row: 2, clientName: 'ROSSI MARIO', fiscalCode: 'RSSMRA80A01H501U', birthDate: '01/01/1980', sourceCode: '005' };

test('normalizes CF and numeric VAT identifiers without losing leading zeroes', () => {
  assert.equal(model.normalizeTaxIdentifier(' rssmra80a01h501u '), row.fiscalCode);
  assert.equal(model.normalizeTaxIdentifier(123456789), '00123456789');
});
test('separates compound surnames and first names using the CF name codes', () => {
  assert.deepEqual(model.splitRegistryName('DE PALMA FRANCESCA', 'DPLFNC50C66L109U'), { firstName: 'FRANCESCA', lastName: 'DE PALMA', needsNameReview: false });
  assert.deepEqual(model.splitRegistryName('MARIO ROSSI', row.fiscalCode), { firstName: 'MARIO', lastName: 'ROSSI', needsNameReview: false });
  assert.equal(model.splitRegistryName('NOME NON COERENTE', row.fiscalCode).needsNameReview, true);
});
test('accepts Italian, ISO and Excel dates and rejects impossible/future dates', () => {
  assert.equal(model.parseRegistryBirthDate('29/02/1980', today), '1980-02-29');
  assert.equal(model.parseRegistryBirthDate('1980-01-01', today), '1980-01-01');
  assert.equal(model.parseRegistryBirthDate(29221, today), '1980-01-01');
  assert.equal(model.parseRegistryBirthDate(new Date('1980-01-01T00:00:00Z'), today), '1980-01-01');
  for (const value of ['29/02/1981', '2026-10-22', '', 'non disponibile']) assert.equal(model.parseRegistryBirthDate(value, today), '');
});
test('merges equivalent duplicates, complementary dates and sources without conflating people', () => {
  const result = model.analyzeRegistryRows([row, { ...row, row: 3, clientName: 'MARIO ROSSI', birthDate: '', sourceCode: '043' }], today);
  assert.equal(result.records.length, 1); assert.equal(result.duplicateRows, 1); assert.equal(result.conflicts, 0);
  assert.deepEqual(result.records[0].sourceCodes, ['005', '043']);
  assert.equal(result.records[0].birthDate, '1980-01-01');
  const conflict = model.analyzeRegistryRows([row, { ...row, row: 3, clientName: 'ROSSI MARIA' }], today);
  assert.equal(conflict.conflicts, 1);
  assert.equal(conflict.records[0].firstName, ''); assert.equal(conflict.records[0].birthDate, '');
  assert.equal(conflict.records[0].alternatives.length, 2);
});
test('reports invalid records and keeps companies distinct', () => {
  const result = model.analyzeRegistryRows([row, { ...row, row: 3, fiscalCode: 'bad' }, { ...row, row: 4, fiscalCode: '00123456789', clientName: '123 SRL' }, { ...row, row: 5, fiscalCode: '00123456789', clientName: '456 SRL' }], today);
  assert.equal(result.skippedRows, 1); assert.equal(result.persons, 1); assert.equal(result.companies, 1); assert.equal(result.conflicts, 1);
});

const plugin = {
  name: 'registry-store', setup(builder) {
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'auth', namespace: 'fixture' }));
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'store', namespace: 'fixture' }));
    builder.onLoad({ filter: /^auth$/, namespace: 'fixture' }, () => ({ contents: 'export const db = {}; export const auth = { get currentUser() { return globalThis.registryUser; } };' }));
    builder.onLoad({ filter: /^store$/, namespace: 'fixture' }, () => ({ contents: `
      export const collection = (db, name) => name;
      export const doc = (db, name, id) => ({ name, id });
      export const serverTimestamp = () => 'server-time';
      export const getDocs = async name => ({ docs: Object.entries(globalThis.registryStore).filter(([key]) => key.startsWith(name + '/')).map(([key, value]) => ({ id: key.slice(name.length + 1), data: () => value })) });
      export const setDoc = async (ref, data) => { globalThis.registryStore[ref.name + '/' + ref.id] = data; };
      export const writeBatch = () => { const writes = []; return {
        set: (ref, data) => writes.push({ ref, data }),
        commit: async () => {
          globalThis.registryCommits += 1;
          if (globalThis.registryFailAt === globalThis.registryCommits) throw new Error('connection lost');
          globalThis.registryBatchSizes.push(writes.length);
          for (const write of writes) await setDoc(write.ref, write.data);
        },
      }; };
    ` }));
  },
};
const service = await loadModule('src/customerRegistry.ts', [plugin]);
function reset() {
  globalThis.registryUser = { email: 'manciniriccardomaria@gmail.com' };
  globalThis.registryStore = {}; globalThis.registryCommits = 0; globalThis.registryBatchSizes = []; globalThis.registryFailAt = 0;
}
test('imports up to 400 writes per batch, retries safely, and preserves unrelated clients', async () => {
  reset();
  const analysis = model.analyzeRegistryRows(Array.from({ length: 405 }, (_, index) => ({ ...row, row: index + 2, fiscalCode: String(index + 1).padStart(11, '0'), clientName: `Azienda ${index}` })), today, 'clients.xlsx', 'Clienti');
  globalThis.registryFailAt = 2;
  await assert.rejects(service.importCustomerRegistry(analysis, () => {}), /400 anagrafiche salvate/);
  assert.equal(Object.keys(globalThis.registryStore).length, 400);
  assert.equal(globalThis.registryStore['customer_registry_meta/current'], undefined);
  globalThis.registryFailAt = 0;
  const retry = await service.importCustomerRegistry(analysis, () => {});
  assert.equal(retry.created, 5); assert.equal(retry.unchanged, 400);
  assert.deepEqual(globalThis.registryBatchSizes, [400, 5]);
  assert.equal(globalThis.registryStore['customer_registry_meta/current'].uniqueRecords, 405);
  const smaller = model.analyzeRegistryRows([{ ...row, fiscalCode: '00000000001', clientName: 'Nome aggiornato' }], today, 'updated.xlsx', 'Clienti');
  const update = await service.importCustomerRegistry(smaller, () => {});
  assert.equal(update.updated, 1); assert.equal(update.totalArchiveRecords, 405);
  assert.equal(globalThis.registryStore['customer_registry/00000000405'].clientName, 'Azienda 404');
});
test('the test collaborator cannot import or change the master registry', async () => {
  reset(); globalThis.registryUser.email = 'manciniriccardo9@gmail.com';
  await assert.rejects(service.importCustomerRegistry(model.analyzeRegistryRows([row], today), () => {}), /amministratori/);
  assert.deepEqual(globalThis.registryStore, {});
});
