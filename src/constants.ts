import { 
  Banknote, 
  Star, 
  Car, 
  Users, 
  Home, 
  FileText, 
  ShieldAlert, 
  Briefcase, 
  HeartPulse, 
  PiggyBank, 
  Zap,
  TrendingUp
} from 'lucide-react';

export const CATEGORIES = [
  { id: 'incassi', label: 'Incassi', icon: Banknote, color: 'text-blue-600' },
  { id: 'recensioni', label: 'Recensioni', icon: Star, color: 'text-yellow-500' },
  { id: 'prevMotorSe', label: 'Preventivi Motor (Se)', icon: Car, color: 'text-blue-500' },
  { id: 'prevMotorTerzi', label: 'Preventivi Motor (Terzi)', icon: Users, color: 'text-blue-400' },
  { id: 'prevRetailSe', label: 'Preventivi Retail (Se)', icon: Home, color: 'text-indigo-500' },
  { id: 'prevRetailTerzi', label: 'Preventivi Retail (Terzi)', icon: Users, color: 'text-indigo-400' },
  { id: 'emissSe', label: 'Emissioni (Se)', icon: FileText, color: 'text-green-600' },
  { id: 'emissTerzi', label: 'Emissioni (Terzi)', icon: Users, color: 'text-green-500' },
  { id: 'sinistriMotor', label: 'Apertura Sinistri (Motor)', icon: ShieldAlert, color: 'text-red-600' },
  { id: 'sinistriRamiVari', label: 'Apertura Sinistri (Rami vari)', icon: ShieldAlert, color: 'text-red-500' },
  { id: 'midCorporate', label: 'Pratiche Mid-Corporate', icon: Briefcase, color: 'text-slate-600' },
  { id: 'contattiVita', label: 'Contatti Vita', icon: HeartPulse, color: 'text-pink-500' },
  { id: 'contattiFondoPensione', label: 'Contatti Fondo pensione', icon: PiggyBank, color: 'text-orange-500' },
  { id: 'contattiEnergia', label: 'Contatti Energia', icon: Zap, color: 'text-yellow-600' },
];

export type CategoryId = typeof CATEGORIES[number]['id'];

export interface DailyReport {
  id?: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  incassi: number;
  recensioni: number;
  prevMotorSe: number;
  prevMotorTerzi: number;
  prevRetailSe: number;
  prevRetailTerzi: number;
  emissSe: number;
  emissTerzi: number;
  sinistriMotor: number;
  sinistriRamiVari: number;
  midCorporate: number;
  contattiVita: number;
  contattiFondoPensione: number;
  contattiEnergia: number;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: 'employee' | 'admin';
}
