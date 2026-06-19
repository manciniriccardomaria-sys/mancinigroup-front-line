export const CALL_STATUSES = [
  { id: 'da_chiamare', label: 'Da chiamare', isDefault: true },
  { id: 'chiamato', label: 'Chiamato', isDefault: false },
  { id: 'da_richiamare', label: 'Da richiamare', isDefault: false },
  { id: 'non_raggiungibile', label: 'Non raggiungibile', isDefault: false },
  {
    id: 'cambio_rottamazione_macchina',
    label: 'Cambio/Rottamaz. macchina',
    isDefault: false,
  },
  { id: 'cliente_perso', label: 'Cliente perso', isDefault: false },
] as const;

export type CallStatusId = typeof CALL_STATUSES[number]['id'];

export const CALL_WORKFLOW_CONFIG = {
  defaultStatus: 'da_chiamare' as CallStatusId,
  statusesAreEditable: true,
  showOverdueCalls: true,
  sourceOwnership: {
    sourceRepresentsPortfolioOwner: true,
    ownerTypes: ['employee', 'collaborator'],
    keepOriginalSourceWhenReassigned: true,
    allowEmployeesToHelpOtherSources: true,
    requireTakeOwnershipBeforeEditing: true,
  },
  callback: {
    status: 'da_richiamare' as CallStatusId,
    requiresDate: true,
  },
} as const;

