import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import {
  Banknote,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarCheck,
  Car,
  CarFront,
  ChartNoAxesCombined,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  HeartHandshake,
  Home,
  HousePlus,
  Info,
  KeyRound,
  Mail,
  MessageCircle,
  PhoneCall,
  PiggyBank,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Star,
  Store,
  Target,
  Users,
  Zap,
} from 'lucide-react';
import { db } from './firebase';

export const REPORT_SECTIONS = [
  { id: 'reception', title: 'Operazioni di ricezione' },
  { id: 'priority', title: 'Strategia commerciale quotidiana | Priorità 1' },
  { id: 'other', title: 'Altre operazioni tracciabili' },
] as const;

export const REPORT_ICON_OPTIONS = [
  { id: 'banknote', label: 'Incassi', icon: Banknote },
  { id: 'car', label: 'Auto', icon: Car },
  { id: 'car-front', label: 'Veicolo', icon: CarFront },
  { id: 'file-check', label: 'Documento', icon: FileCheck2 },
  { id: 'home', label: 'Casa', icon: Home },
  { id: 'house-plus', label: 'Casa plus', icon: HousePlus },
  { id: 'info', label: 'Informazioni', icon: Info },
  { id: 'store', label: 'Negozio', icon: Store },
  { id: 'chart', label: 'Grafico', icon: ChartNoAxesCombined },
  { id: 'heart', label: 'Relazione', icon: HeartHandshake },
  { id: 'phone', label: 'Telefonata', icon: PhoneCall },
  { id: 'book-check', label: 'Consegna', icon: BookOpenCheck },
  { id: 'shopping-bag', label: 'Retail', icon: ShoppingBag },
  { id: 'shield-alert', label: 'Sinistro', icon: ShieldAlert },
  { id: 'shield-check', label: 'Protezione', icon: ShieldCheck },
  { id: 'briefcase', label: 'Pratica', icon: BriefcaseBusiness },
  { id: 'piggy-bank', label: 'Risparmio', icon: PiggyBank },
  { id: 'zap', label: 'Energia', icon: Zap },
  { id: 'star', label: 'Stella', icon: Star },
  { id: 'key', label: 'Chiave', icon: KeyRound },
  { id: 'target', label: 'Obiettivo', icon: Target },
  { id: 'users', label: 'Persone', icon: Users },
  { id: 'message', label: 'Messaggio', icon: MessageCircle },
  { id: 'mail', label: 'Email', icon: Mail },
  { id: 'calendar-check', label: 'Scadenza', icon: CalendarCheck },
  { id: 'clipboard-check', label: 'Attività', icon: ClipboardCheck },
  { id: 'dollar', label: 'Valore', icon: CircleDollarSign },
] as const;

export const REPORT_COLOR_OPTIONS = [
  { id: 'text-blue-600', label: 'Blu', swatch: 'bg-blue-600' },
  { id: 'text-indigo-600', label: 'Indaco', swatch: 'bg-indigo-600' },
  { id: 'text-violet-600', label: 'Viola', swatch: 'bg-violet-600' },
  { id: 'text-fuchsia-600', label: 'Fucsia', swatch: 'bg-fuchsia-600' },
  { id: 'text-pink-600', label: 'Rosa', swatch: 'bg-pink-600' },
  { id: 'text-rose-600', label: 'Rosso', swatch: 'bg-rose-600' },
  { id: 'text-cyan-600', label: 'Ciano', swatch: 'bg-cyan-600' },
  { id: 'text-green-600', label: 'Verde', swatch: 'bg-green-600' },
  { id: 'text-emerald-600', label: 'Smeraldo', swatch: 'bg-emerald-600' },
  { id: 'text-amber-600', label: 'Ambra', swatch: 'bg-amber-600' },
  { id: 'text-orange-600', label: 'Arancio', swatch: 'bg-orange-600' },
  { id: 'text-yellow-600', label: 'Giallo', swatch: 'bg-yellow-500' },
] as const;

export type ReportIconId = typeof REPORT_ICON_OPTIONS[number]['id'];
export type ReportColorId = typeof REPORT_COLOR_OPTIONS[number]['id'];
export type ReportSectionId = typeof REPORT_SECTIONS[number]['id'];

export type ReportCategory = {
  id: string;
  label: string;
  sectionId: ReportSectionId;
  iconKey: ReportIconId;
  color: ReportColorId;
  order: number;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type ReportCategorySection = {
  id: ReportSectionId;
  title: string;
  categories: ReportCategory[];
};

const ICON_BY_KEY = Object.fromEntries(
  REPORT_ICON_OPTIONS.map(option => [option.id, option.icon])
) as Record<ReportIconId, typeof Banknote>;

export function getReportCategoryIcon(iconKey: string) {
  return ICON_BY_KEY[iconKey as ReportIconId] || ClipboardCheck;
}

export function groupReportCategories(
  categories: ReportCategory[]
): ReportCategorySection[] {
  return REPORT_SECTIONS.map(section => ({
    ...section,
    categories: categories.filter(category => category.sectionId === section.id),
  })).filter(section => section.categories.length > 0);
}

export function useReportCategories() {
  const [categories, setCategories] = useState<ReportCategory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => onSnapshot(collection(db, 'report_categories'), snapshot => {
    setCategories(
      snapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as ReportCategory))
        .sort((first, second) =>
          first.order - second.order ||
          first.label.localeCompare(second.label, 'it')
        )
    );
    setLoading(false);
  }), []);

  const sections = useMemo(
    () => groupReportCategories(categories),
    [categories]
  );

  return { categories, sections, loading };
}

export const DEFAULT_REPORT_CATEGORIES: ReportCategory[] = [
  defaultCategory('incassi', 'Incassi', 'reception', 'banknote', 'text-blue-600', 10),
  defaultCategory('prevMotorSe', 'Preventivi Motor (se)', 'reception', 'car', 'text-indigo-600', 20),
  defaultCategory('emissMotorSe', 'Emissioni Motor (se)', 'reception', 'file-check', 'text-violet-600', 30),
  defaultCategory('prevRetailSe', 'Preventivi Retail (se)', 'reception', 'home', 'text-fuchsia-600', 40),
  defaultCategory('emissRetailSe', 'Emissioni Retail (se)', 'reception', 'house-plus', 'text-pink-600', 50),
  defaultCategory('infoVarie', 'Info varie', 'reception', 'info', 'text-cyan-600', 60),
  defaultCategory('smeg', 'SMEG', 'priority', 'store', 'text-rose-600', 110),
  defaultCategory('vitarivConsegna', 'Vitariv (consegna)', 'priority', 'chart', 'text-green-600', 120),
  defaultCategory('longevityCare', 'Longevity Care', 'priority', 'heart', 'text-fuchsia-600', 130),
  defaultCategory('winbackMag25', 'Winback (Mag25)', 'priority', 'phone', 'text-blue-600', 140),
  defaultCategory('scegliAllianzGen26', 'ScegliAllianz (Gen26)', 'priority', 'phone', 'text-indigo-600', 150),
  defaultCategory('scegliAllianzConsegna', 'ScegliAllianz (Consegna)', 'priority', 'book-check', 'text-pink-600', 160),
  defaultCategory('prevMotorTerzi', 'Preventivi Motor (terzi)', 'other', 'car-front', 'text-indigo-600', 210),
  defaultCategory('prevRetailTerzi', 'Preventivi Retail (terzi)', 'other', 'shopping-bag', 'text-fuchsia-600', 220),
  defaultCategory('sinistriMotor', 'Apertura Sinistri (motor)', 'other', 'shield-alert', 'text-violet-600', 230),
  defaultCategory('sinistriRetail', 'Apertura Sinistri (retail)', 'other', 'shield-check', 'text-violet-600', 240),
  defaultCategory('midCorporate', 'Pratiche Mid-Co', 'other', 'briefcase', 'text-orange-600', 250),
  defaultCategory('contattiFondoPensione', 'Contatti Fondo Pensione', 'other', 'piggy-bank', 'text-violet-600', 260),
  defaultCategory('contattiProtection', 'Contatti Protection', 'other', 'heart', 'text-pink-600', 270),
  defaultCategory('contattiEnergia', 'Contatti Energia', 'other', 'zap', 'text-green-600', 280),
  defaultCategory('recensioni', 'Recensioni', 'other', 'star', 'text-yellow-600', 290),
  defaultCategory('contattiNoleggio', 'Contatti Noleggio', 'other', 'key', 'text-fuchsia-600', 300),
];

function defaultCategory(
  id: string,
  label: string,
  sectionId: ReportSectionId,
  iconKey: ReportIconId,
  color: ReportColorId,
  order: number,
): ReportCategory {
  return { id, label, sectionId, iconKey, color, order };
}
