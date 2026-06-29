export type CategoryId = string;

export type DailyReport = {
  id?: string;
  userId: string;
  userName: string;
  date: string;
  values?: Record<string, number>;
  [key: string]: unknown;
};

export type DailyObjectives = {
  enabled: boolean;
  values: Record<string, number>;
  updatedBy?: string;
  updatedAt?: unknown;
};

export type Notice = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function createEmptyDailyObjectives(): DailyObjectives {
  return {
    enabled: false,
    values: {},
  };
}

export function getReportCategoryValue(
  report: Partial<DailyReport>,
  categoryId: CategoryId
): number {
  const dynamicValue = report.values?.[categoryId];
  if (typeof dynamicValue === 'number') return dynamicValue;

  const currentValue = report[categoryId];
  if (typeof currentValue === 'number') return currentValue;

  if (categoryId === 'emissMotorSe') return Number(report.emissSe) || 0;
  if (categoryId === 'sinistriRetail') return Number(report.sinistriRamiVari) || 0;
  if (categoryId === 'contattiProtection') return Number(report.contattiVita) || 0;

  return 0;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'employee' | 'admin';
}

export interface AuthorizedEmployee {
  name: string;
  email: string;
  sourceCodes: readonly string[];
  canHelpOtherSources?: boolean;
}

export const AUTHORIZED_EMPLOYEES: readonly AuthorizedEmployee[] = [
  {
    name: 'Marina Bartoli',
    email: 'b.marinamancinigroup@gmail.com',
    sourceCodes: ['005', '043'],
  },
  {
    name: 'Isabella Cappelluti',
    email: 'isabella.cappelluti@gmail.com',
    sourceCodes: ['057', '022'],
  },
  {
    name: 'Nicoletta Cecchini',
    email: 'nicolemancinigroup@gmail.com',
    sourceCodes: ['017'],
  },
  {
    name: 'Rosa Ruggieri',
    email: 'rossellamancinigroup@gmail.com',
    sourceCodes: ['003', '045'],
  },
  {
    name: 'Angela Sforza',
    email: 's.angelamancinigroup@gmail.com',
    sourceCodes: ['028', '082', '038'],
  },
  {
    name: 'Maria Valeria Bellapianta',
    email: 'valeriamancinigroup@gmail.com',
    sourceCodes: ['008'],
  },
  {
    name: 'Gaetano Calo',
    email: 'gaetanocalo73@gmail.com',
    sourceCodes: ['032', '013'],
    canHelpOtherSources: false,
  },
] as const;

export const AUTHORIZED_AGENTS = [
  { name: 'Riccardo', email: 'manciniriccardomaria@gmail.com' },
  { name: 'Pasquale', email: 'pasqualemancini62@gmail.com' },
  { name: 'Davide', email: 'davidedalianipoli@gmail.com' },
] as const;

function normalizeEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase();
}

export function getAuthorizedEmployee(email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  return AUTHORIZED_EMPLOYEES.find(employee => employee.email === normalizedEmail);
}

export function getAuthorizedAgent(email: string | null | undefined) {
  const normalizedEmail = normalizeEmail(email);
  return AUTHORIZED_AGENTS.find(agent => agent.email === normalizedEmail);
}

export function getAuthorizedUser(email: string | null | undefined) {
  const agent = getAuthorizedAgent(email);
  if (agent) return { ...agent, role: 'admin' as const };

  const employee = getAuthorizedEmployee(email);
  if (employee) return { ...employee, role: 'employee' as const };

  return undefined;
}

export function isAuthorizedAgent(email: string | null | undefined) {
  return Boolean(getAuthorizedAgent(email));
}

export function isAuthorizedEmail(email: string | null | undefined) {
  return Boolean(getAuthorizedUser(email));
}
