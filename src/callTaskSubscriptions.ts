import {
  collection,
  onSnapshot,
  query,
  Unsubscribe,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { CallTask } from './callCenter';

const FIRESTORE_IN_LIMIT = 10;

export function subscribeToCallTasksForEmployee(
  sourceCodes: readonly string[],
  assignedToUid: string,
  onTasks: (tasks: CallTask[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  return subscribeToCallTasksByQueries(
    [
      ...chunkValues([...new Set(sourceCodes)].filter(Boolean), FIRESTORE_IN_LIMIT)
        .map(chunk => query(
          collection(db, 'call_tasks'),
          where('sourceCode', 'in', chunk),
        )),
      ...(assignedToUid
        ? [query(collection(db, 'call_tasks'), where('assignedToUid', '==', assignedToUid))]
        : []),
    ],
    onTasks,
    onError,
  );
}

export function subscribeToCallTasksBySourceCodes(
  sourceCodes: readonly string[],
  onTasks: (tasks: CallTask[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  return subscribeToCallTasksByQueries(
    chunkValues([...new Set(sourceCodes)].filter(Boolean), FIRESTORE_IN_LIMIT)
      .map(chunk => query(
        collection(db, 'call_tasks'),
        where('sourceCode', 'in', chunk),
      )),
    onTasks,
    onError,
  );
}

function subscribeToCallTasksByQueries(
  queries: ReturnType<typeof query>[],
  onTasks: (tasks: CallTask[]) => void,
  onError: (error: unknown) => void,
): Unsubscribe {
  if (queries.length === 0) {
    onTasks([]);
    return () => {};
  }

  const snapshots = new Map<number, Map<string, CallTask>>();
  const unsubscribes = queries.map((taskQuery, index) =>
    onSnapshot(taskQuery, snapshot => {
      snapshots.set(index, new Map(snapshot.docs.map(item => {
        const data = item.data() as Record<string, unknown>;
        return [
          item.id,
          {
            id: item.id,
            ...data,
          } as CallTask,
        ];
      })));

      const merged = new Map<string, CallTask>();
      snapshots.forEach(tasks => {
        tasks.forEach((task, id) => {
          merged.set(id, task);
        });
      });
      onTasks([...merged.values()]);
    }, onError)
  );

  return () => unsubscribes.forEach(unsubscribe => unsubscribe());
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}
