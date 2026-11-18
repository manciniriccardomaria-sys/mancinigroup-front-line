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
const {
  importCallTasks, isTaskExpired, isTaskBeforeTrackingStart,
  isTaskWithinWorkingPeriod, canEditTaskOutcome, isTaskActionable, getTaskCallbackDeadline,
} = await loadModule('src/callCenter.ts', [firestoreMock]);
const { matchesWinbackCalendarGroup } = await loadModule('src/winbackCalendar.ts', [firestoreMock]);

test('Winback counters match the calendar day, callback deadlines and recorded outcomes', () => {
  const groups = ['due', 'overdue', 'done'];
  const matches = task => groups.filter(group => matchesWinbackCalendarGroup({ ...baseTask, ...task }, group, today));

  assert.deepEqual(matches({ dueDate: today }), ['due']);
  assert.deepEqual(matches({ eventDate: today }), ['overdue']);
  assert.deepEqual(matches({ eventDate: '2026-10-06' }), []);
  assert.deepEqual(matches({ dueDate: '2026-10-12' }), []);
  assert.deepEqual(matches({ status: 'chiamato', calledDate: today }), ['done']);
  assert.deepEqual(matches({ status: 'chiamato', calledDate: '2026-10-07' }), []);
  assert.deepEqual(matches({ status: 'ripreso', updatedAt: '2026-10-07T22:30:00Z' }), ['done']);
  assert.deepEqual(matches({ status: 'non_raggiungibile', updatedAt: '2026-10-08T10:00:00Z' }), ['overdue', 'done']);
  assert.deepEqual(matches({ status: 'da_richiamare', callbackDate: today }), ['due']);
  assert.deepEqual(matches({ status: 'da_richiamare', callbackDate: '2026-10-12', updatedAt: '2026-10-08T10:00:00Z' }), ['done']);
  assert.deepEqual(matches({ category: 'campagna', dueDate: today }), []);
});

test('July Winback stays editable in history and outside the November queue', () => {
  const november = '2026-11-18';
  for (const dueDate of ['2026-07-06', '2026-05-01']) {
    for (const status of ['da_chiamare', 'non_raggiungibile', 'da_richiamare']) {
      const task = { ...baseTask, dueDate, eventDate: '2026-07-21', status,
        ...(status === 'da_richiamare' ? { callbackDate: '2026-07-20' } : {}) };
      const original = structuredClone(task);
      assert.equal(isTaskExpired(task, november), true);
      assert.equal(isTaskWithinWorkingPeriod(task, november), false);
      assert.equal(canEditTaskOutcome(task, november), true);
      assert.equal(isTaskActionable(task, november), false);
      assert.equal(matchesWinbackCalendarGroup(task, 'overdue', november), false);
      const dates = history.getTaskCalendarDates(task, november, isTaskActionable(task, november));
      assert.ok(dates.includes(dueDate));
      assert.ok(!dates.includes(november));
      assert.deepEqual(task, original);
    }
  }
});

test('closed Winback outcomes can be corrected after the anniversary without reentering the queue', () => {
  for (const status of ['chiamato', 'ripreso', 'non_gradito', 'cliente_perso', 'cambio_rottamazione_macchina']) {
    const task = { ...baseTask, status, eventDate: '2026-10-06', updatedAt: '2026-10-07T12:00:00Z' };
    assert.equal(canEditTaskOutcome(task, today), true);
    assert.equal(isTaskActionable(task, today), false);
    assert.deepEqual(history.getTaskCalendarDates(task, today, false), ['2026-10-05', '2026-10-07']);
    assert.equal(isTaskActionable({ ...task, status: 'da_chiamare' }, today), false);
  }
});

test('Winback callbacks can follow the anniversary and only become due on their scheduled date', () => {
  const task = { ...baseTask, status: 'da_richiamare', eventDate: '2026-10-06', callbackDate: '2026-10-12' };
  assert.equal(getTaskCallbackDeadline(task), undefined);
  assert.equal(isTaskWithinWorkingPeriod(task, today), true);
  assert.equal(isTaskActionable(task, today), false);
  assert.equal(isTaskActionable(task, '2026-10-12'), true);
  assert.equal(matchesWinbackCalendarGroup(task, 'due', '2026-10-12'), true);
  assert.equal(isTaskActionable(task, '2026-10-13'), false);
  assert.deepEqual(history.getTaskCalendarDates(task, today, false), ['2026-10-05', '2026-10-12']);
  assert.equal(isTaskActionable({ ...baseTask, dueDate: '2026-10-12' }, today), false);
});

test('other categories keep their expiration, tracking start and callback deadline', () => {
  for (const category of ['campagna', 'scadenza_rata', 'scadenza_annuale']) {
    const task = { ...baseTask, category, importType: 'expirations' };
    assert.equal(isTaskActionable(task, today), true);
    assert.equal(getTaskCallbackDeadline(task), task.eventDate);
    const expired = { ...task, eventDate: '2026-10-06' };
    assert.equal(isTaskExpired(expired, today), true);
    assert.equal(isTaskWithinWorkingPeriod(expired, today), false);
    assert.equal(canEditTaskOutcome(expired, today), false);
    assert.equal(isTaskActionable(expired, today), false);
    assert.equal(isTaskWithinWorkingPeriod({ ...expired, status: 'ripreso' }, today), false);
    const beforeTracking = { ...task, dueDate: '2026-05-01' };
    assert.equal(isTaskBeforeTrackingStart(beforeTracking), true);
    assert.equal(isTaskWithinWorkingPeriod(beforeTracking, today), false);
    assert.equal(isTaskActionable(beforeTracking, today), false);
  }
});

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
