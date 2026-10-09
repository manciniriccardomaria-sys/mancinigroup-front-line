import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';

async function loadModule(entryPoint, plugins = []) {
  const result = await build({
    entryPoints: [entryPoint], bundle: true, write: false,
    platform: 'node', format: 'esm', plugins,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const history = await loadModule('src/callHistory.ts');
const today = '2026-10-08';
const baseTask = {
  id: 'call-1', category: 'winback', importType: 'winback',
  dueDate: '2026-10-05', eventDate: '2026-10-20', status: 'da_chiamare',
};

test('every completed outcome stays on its original date and action date', () => {
  for (const status of ['chiamato', 'ripreso', 'non_gradito', 'cliente_perso', 'cambio_rottamazione_macchina']) {
    const task = { ...baseTask, status, updatedAt: { toDate: () => new Date('2026-10-07T22:30:00Z') } };
    assert.equal(history.isTaskInHistory(task, today), true);
    assert.deepEqual(history.getTaskCalendarDates(task, today, false), ['2026-10-05', today]);
  }
});

test('a callback keeps the original appointment, action and next callback visible', () => {
  const task = { ...baseTask, status: 'da_richiamare', callbackDate: '2026-10-12', updatedAt: '2026-10-07T12:00:00Z' };
  assert.deepEqual(history.getTaskCalendarDates(task, today, false), ['2026-10-05', '2026-10-12', '2026-10-07']);
});

test('overdue calls appear today and remain consultable in the past', () => {
  assert.deepEqual(history.getTaskCalendarDates(baseTask, today, true), ['2026-10-05', today]);
});

test('expired calls and worked calls in inactive campaigns remain historical', () => {
  assert.equal(history.isTaskInHistory({ ...baseTask, eventDate: '2026-10-06' }, today), true);
  assert.equal(history.isTaskInHistory({ ...baseTask, dueDate: '2026-10-12', status: 'non_raggiungibile', campaignId: 'inactive' }, today), true);
  assert.equal(history.isTaskInHistory({ ...baseTask, dueDate: '2026-10-12' }, today), false);
});

test('same-day calendar entries are counted once and legacy calledDate is preserved', () => {
  assert.deepEqual(history.getTaskCalendarDates({ ...baseTask, dueDate: today, status: 'chiamato', calledDate: today }, today, false), [today]);
  assert.deepEqual(history.getTaskCalendarDates({ ...baseTask, status: 'chiamato', calledDate: '2026-10-06' }, today, false), ['2026-10-05', '2026-10-06']);
});

test('pruning only removes future unworked calls', () => {
  assert.equal(history.canDiscardUnworkedTask({ ...baseTask, dueDate: '2026-10-12' }, today), true);
  for (const task of [baseTask, { ...baseTask, dueDate: today },
    { ...baseTask, dueDate: '2026-10-12', status: 'ripreso' },
    { ...baseTask, dueDate: '2026-10-12', assignedToUid: 'operator' },
    { ...baseTask, dueDate: '2026-10-12', updatedByUid: 'operator' }]) {
    assert.equal(history.canDiscardUnworkedTask(task, today), false);
  }
});

const firestoreMock = {
  name: 'in-memory-firestore',
  setup(builder) {
    builder.onResolve({ filter: /^firebase\/firestore$/ }, () => ({ path: 'firestore', namespace: 'mock' }));
    builder.onResolve({ filter: /^\.\/firebase$/ }, () => ({ path: 'db', namespace: 'mock' }));
    builder.onLoad({ filter: /^db$/, namespace: 'mock' }, () => ({ contents: 'export const db = {};' }));
    builder.onLoad({ filter: /^firestore$/, namespace: 'mock' }, () => ({ contents: `
      export const collection = (db, name) => name;
      export const doc = (db, name, id) => ({ name, id });
      export const query = (...args) => args;
      export const where = (...args) => args;
      export const serverTimestamp = () => 'server-time';
      export const getDocs = async () => ({ docs: globalThis.callHistoryStore.map(task => ({ id: task.id, data: () => task })) });
      export const addDoc = async () => {};
      export const writeBatch = () => ({
        delete: ref => globalThis.callHistoryWrites.push({ type: 'delete', ref }),
        set: (ref, data) => globalThis.callHistoryWrites.push({ type: 'set', ref, data }),
        commit: async () => {},
      });
    ` }));
  },
};
const { importCallTasks } = await loadModule('src/callCenter.ts', [firestoreMock]);

test('reimports preserve outcomes and original dates for every import type', async () => {
  for (const kind of ['newClients', 'expirations', 'winback']) {
    globalThis.callHistoryStore = [{ ...baseTask, importType: kind, status: 'chiamato', calledDate: '2026-10-06', sourceFingerprint: 'old' }];
    globalThis.callHistoryWrites = [];
    const result = await importCallTasks({ kind, fileName: 'updated.xlsx', sheetName: 'clients', rowCount: 1, skippedRows: 0,
      tasks: [{ ...baseTask, importType: kind, dueDate: '2099-10-12', sourceFingerprint: 'new' }] });
    assert.equal(result.unchanged, 1);
    assert.deepEqual(globalThis.callHistoryWrites, []);
  }
});

test('expiration reimports retain past and claimed calls, prune only unused future ones', async () => {
  globalThis.callHistoryStore = [
    { ...baseTask, importType: 'expirations', id: 'past', dueDate: '2000-01-01' },
    { ...baseTask, importType: 'expirations', id: 'claimed', dueDate: '2099-01-01', eventDate: '2099-02-01', assignedToUid: 'operator' },
    { ...baseTask, importType: 'expirations', id: 'future', dueDate: '2099-01-01', eventDate: '2099-02-01' },
  ];
  globalThis.callHistoryWrites = [];
  await importCallTasks({ kind: 'expirations', fileName: 'updated.xlsx', sheetName: 'clients', rowCount: 0, skippedRows: 0, tasks: [] });
  assert.deepEqual(globalThis.callHistoryWrites.map(write => [write.type, write.ref.id]), [['delete', 'future']]);
});

test('future unworked calls still receive import updates', async () => {
  globalThis.callHistoryStore = [{ ...baseTask, dueDate: '2099-01-01', eventDate: '2099-02-01', sourceFingerprint: 'old' }];
  globalThis.callHistoryWrites = [];
  const result = await importCallTasks({ kind: 'winback', fileName: 'updated.xlsx', sheetName: 'clients', rowCount: 1, skippedRows: 0,
    tasks: [{ ...baseTask, dueDate: '2099-01-12', eventDate: '2099-02-01', sourceFingerprint: 'new' }] });
  assert.equal(result.updated, 1);
  assert.equal(globalThis.callHistoryWrites.length, 1);
  assert.equal(globalThis.callHistoryWrites[0].data.dueDate, '2099-01-12');
});
