import {
  Banknote,
  BookOpenCheck,
  BriefcaseBusiness,
  Car,
  CarFront,
  ChartNoAxesCombined,
  FileCheck2,
  HeartHandshake,
  Home,
  HousePlus,
  Info,
  KeyRound,
  PhoneCall,
  PiggyBank,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Zap,
} from 'lucide-react';

export const CATEGORY_SECTIONS = [
  {
    id: 'reception',
    title: 'Operazioni di ricezione',
    categories: [
      { id: 'incassi', label: 'Incassi', icon: Banknote, color: 'text-blue-600' },
      { id: 'prevMotorSe', label: 'Preventivi Motor (se)', icon: Car, color: 'text-indigo-600' },
      { id: 'emissMotorSe', label: 'Emissioni Motor (se)', icon: FileCheck2, color: 'text-violet-600' },
      { id: 'prevRetailSe', label: 'Preventivi Retail (se)', icon: Home, color: 'text-fuchsia-600' },
      { id: 'emissRetailSe', label: 'Emissioni Retail (se)', icon: HousePlus, color: 'text-pink-600' },
      { id: 'infoVarie', label: 'Info varie', icon: Info, color: 'text-cyan-600' },
    ],
  },
  {
    id: 'priority',
    title: 'Strategia commerciale quotidiana | Priorità 1',
    categories: [
      {
        id: 'smeg',
        label: 'SMEG',
        icon: Store,
        color: 'text-rose-600',
      },
      {
        id: 'vitarivConsegna',
        label: 'Vitariv (consegna)',
        icon: ChartNoAxesCombined,
        color: 'text-green-600',
      },
      {
        id: 'longevityCare',
        label: 'Longevity Care',
        icon: HeartHandshake,
        color: 'text-fuchsia-600',
      },
      { id: 'winbackMag25', label: 'Winback (Mag25)', icon: PhoneCall, color: 'text-blue-700' },
      { id: 'scegliAllianzGen26', label: 'ScegliAllianz (Gen26)', icon: PhoneCall, color: 'text-indigo-700' },
      {
        id: 'scegliAllianzConsegna',
        label: 'ScegliAllianz (Consegna)',
        icon: BookOpenCheck,
        color: 'text-pink-600',
      },
    ],
  },
  {
    id: 'other',
    title: 'Altre operazioni tracciabili',
    categories: [
      { id: 'prevMotorTerzi', label: 'Preventivi Motor (terzi)', icon: CarFront, color: 'text-indigo-600' },
      { id: 'prevRetailTerzi', label: 'Preventivi Retail (terzi)', icon: ShoppingBag, color: 'text-fuchsia-600' },
      { id: 'sinistriMotor', label: 'Apertura Sinistri (motor)', icon: ShieldAlert, color: 'text-violet-600' },
      { id: 'sinistriRetail', label: 'Apertura Sinistri (retail)', icon: ShieldCheck, color: 'text-purple-600' },
      { id: 'midCorporate', label: 'Pratiche Mid-Co', icon: BriefcaseBusiness, color: 'text-orange-600' },
      {
        id: 'contattiFondoPensione',
        label: 'Contatti Fondo Pensione',
        icon: PiggyBank,
        color: 'text-violet-600',
      },
      { id: 'contattiProtection', label: 'Contatti Protection', icon: HeartHandshake, color: 'text-pink-600' },
      { id: 'contattiEnergia', label: 'Contatti Energia', icon: Zap, color: 'text-green-600' },
      { id: 'recensioni', label: 'Recensioni', icon: Star, color: 'text-yellow-600' },
      { id: 'contattiNoleggio', label: 'Contatti Noleggio', icon: KeyRound, color: 'text-fuchsia-600' },
    ],
  },
] as const;

export const CATEGORIES = CATEGORY_SECTIONS.flatMap(section => [...section.categories]);

export type CategoryId = typeof CATEGORY_SECTIONS[number]['categories'][number]['id'];

type LegacyCategoryId =
  | 'emissSe'
  | 'emissTerzi'
  | 'sinistriRamiVari'
  | 'contattiVita';

export type DailyReport = {
  id?: string;
  userId: string;
  userName: string;
  date: string;
} & Record<CategoryId, number> & Partial<Record<LegacyCategoryId, number>>;

export type DailyObjectives = {
  enabled: boolean;
  updatedBy?: string;
  updatedAt?: unknown;
} & Record<CategoryId, number>;

export type Notice = {
  id: string;
  title: string;
  body: string;
  active: boolean;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function createEmptyCategoryCounts(): Record<CategoryId, number> {
  return Object.fromEntries(
    CATEGORIES.map(category => [category.id, 0])
  ) as Record<CategoryId, number>;
}

export function createEmptyDailyObjectives(): DailyObjectives {
  return {
    enabled: false,
    ...createEmptyCategoryCounts(),
  };
}

export function getReportCategoryValue(
  report: Partial<DailyReport>,
  categoryId: CategoryId
): number {
  const currentValue = report[categoryId];
  if (typeof currentValue === 'number') return currentValue;

  if (categoryId === 'emissMotorSe') return report.emissSe || 0;
  if (categoryId === 'sinistriRetail') return report.sinistriRamiVari || 0;
  if (categoryId === 'contattiProtection') return report.contattiVita || 0;

  return 0;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'employee' | 'admin';
}

export const AUTHORIZED_EMPLOYEES = [
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
    name: 'Riccardo Test',
    email: 'manciniriccardo9@gmail.com',
    sourceCodes: [],
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
