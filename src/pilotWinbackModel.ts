export const PILOT_WINBACK_COLLECTION = 'pilot_winback_calls';
export const WINBACK_OUTCOMES = [
  { id: 'reached', label: 'Cliente raggiunto' },
  { id: 'not_reached', label: 'Non raggiungibile' },
  { id: 'recovered', label: 'Cliente recuperato' },
] as const;
export type WinbackOutcome = typeof WINBACK_OUTCOMES[number]['id'];
export type PilotWinbackCall = {
  id: string;
  ownerUid: string;
  taskId: string;
  customerKey: string;
  clientName: string;
  sourceCode: string;
  sourceName: string;
  calledDate: string;
  outcome: WinbackOutcome;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function summarizeWinbackCalls(calls: PilotWinbackCall[], ownerUid: string, date: string) {
  // Deduplicate snapshot deliveries, never status transitions. A retry keeps the same event ID.
  const daily = [...new Map(calls.filter(call => call.ownerUid === ownerUid && call.calledDate === date)
    .map(call => [call.id, call])).values()];
  return {
    calls: daily.length,
    reached: new Set(daily.filter(call => call.outcome !== 'not_reached').map(call => call.customerKey)).size,
    recovered: new Set(daily.filter(call => call.outcome === 'recovered').map(call => call.customerKey)).size,
  };
}
