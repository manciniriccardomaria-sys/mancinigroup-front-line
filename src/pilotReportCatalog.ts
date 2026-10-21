import type { ReportCategory, ReportIconId } from './reportCatalog';

export type PilotReportCategory = ReportCategory & {
  activity: string;
  group?: string;
  proposalOptions?: PilotReportCategory[];
};

function item(id: string, label: string, activity: string, iconKey: ReportIconId, group?: string): PilotReportCategory {
  return { id, label, activity, iconKey, group, sectionId: 'priority', color: 'text-blue-600', order: 0 };
}

export const PILOT_REPORT_SECTIONS = [
  {
    id: 'reception', title: 'Ricezione', description: 'Sportello, assistenza e gestione pratiche',
    color: 'border-t-blue-600', iconKey: 'users' as ReportIconId,
    categories: [
      item('incassi', 'Incassi', 'Operazioni di incasso', 'banknote'),
      item('infoVarie', 'Assistenza e informazioni', 'Richieste gestite', 'info'),
      item('sinistriMotor', 'Sinistri Motor', 'Aperture', 'shield-alert'),
      item('sinistriRetail', 'Sinistri Retail', 'Aperture', 'shield-check'),
      item('midCorporate', 'Mid Corporate', 'Pratiche gestite', 'briefcase'),
    ],
  },
  {
    id: 'promotion', title: 'Promozione', description: 'Sviluppo commerciale e relazione con il cliente',
    color: 'border-t-violet-500', iconKey: 'target' as ReportIconId,
    categories: [
      item('prevMotorSe', 'Motor', 'Preventivi presentati', 'car', 'Preventivi e proposte'),
      item('prevUltraSalute', 'ULTRA Salute', 'Proposte presentate', 'heart', 'Preventivi e proposte'),
      item('smeg', 'SMEG', 'Proposte presentate', 'store', 'Preventivi e proposte'),
      item('prevUltraCasa', 'ULTRA Casa', 'Proposte presentate', 'home', 'Preventivi e proposte'),
      item('prevUltraImpresa', 'ULTRA Impresa', 'Proposte presentate', 'briefcase', 'Preventivi e proposte'),
      {
        ...item('protection', 'Protection', 'Proposte presentate', 'shield-check', 'Preventivi e proposte'),
        proposalOptions: [
          item('longevityCare', 'Longevity Care', 'Proposte presentate', 'heart', 'Preventivi e proposte'),
          item('contattiProtection', 'Lovia', 'Proposte presentate', 'shield-check', 'Preventivi e proposte'),
        ],
      },
      item('contattiFondoPensione', 'Fondo pensione', 'Contatti commerciali', 'piggy-bank', 'Contatti, consegne e recensioni'),
      item('contattiEnergia', 'Energia', 'Contatti commerciali', 'zap', 'Contatti, consegne e recensioni'),
      item('contattiNoleggio', 'Noleggio', 'Contatti commerciali', 'key', 'Contatti, consegne e recensioni'),
      item('vitarivConsegna', 'Vitariv', 'Consegne effettuate', 'book-check', 'Contatti, consegne e recensioni'),
      item('scegliAllianzConsegna', 'ScegliAllianz', 'Consegne effettuate', 'book-check', 'Contatti, consegne e recensioni'),
      item('recensioni', 'Recensioni', 'Recensioni raccolte', 'star', 'Contatti, consegne e recensioni'),
    ],
  },
  {
    id: 'issuance', title: 'Emissione', description: 'Contratti effettivamente emessi',
    color: 'border-t-blue-500', iconKey: 'file-check' as ReportIconId,
    categories: [
      item('emissMotorSe', 'Motor', 'Contratti emessi', 'car'),
      item('emissUltraSalute', 'ULTRA Salute', 'Contratti emessi', 'heart'),
      item('emissSmeg', 'SMEG', 'Contratti emessi', 'store'),
      item('emissUltraCasa', 'ULTRA Casa', 'Contratti emessi', 'home'),
      item('emissUltraImpresa', 'ULTRA Impresa', 'Contratti emessi', 'briefcase'),
    ],
  },
  {
    id: 'thirdParty', title: 'Terzi', description: 'Preventivi preparati per terzi',
    color: 'border-t-amber-500', iconKey: 'car-front' as ReportIconId,
    categories: [
      item('prevMotorTerzi', 'Motor', 'Preventivi per terzi', 'car'),
      item('prevUltraSaluteTerzi', 'ULTRA Salute', 'Preventivi per terzi', 'heart'),
      item('prevSmegTerzi', 'SMEG', 'Preventivi per terzi', 'store'),
      item('prevUltraCasaTerzi', 'ULTRA Casa', 'Preventivi per terzi', 'home'),
      item('prevUltraImpresaTerzi', 'ULTRA Impresa', 'Preventivi per terzi', 'briefcase'),
    ],
  },
];

// Keep the original product IDs for saved activities, objectives and history.
export const PILOT_REPORT_CATEGORIES = PILOT_REPORT_SECTIONS.flatMap(section =>
  section.categories.flatMap((category: PilotReportCategory) => category.proposalOptions ?? [category])
);
export const PILOT_RETIRED_CATEGORIES: ReportCategory[] = [
  item('prevRetailSe', 'Preventivi Retail · precedente classificazione', '', 'home'),
  item('emissRetailSe', 'Emissioni Retail · precedente classificazione', '', 'file-check'),
  item('prevRetailTerzi', 'Preventivi Retail per terzi · precedente classificazione', '', 'shopping-bag'),
  item('winbackMag25', 'Winback · precedente conteggio manuale', '', 'phone'),
];

export function pilotActivityLabel(category: PilotReportCategory): string {
  return `${category.label} · ${category.activity.toLocaleLowerCase('it')}`;
}
