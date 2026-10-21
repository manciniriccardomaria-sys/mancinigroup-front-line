import { Fragment } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { DailyReport } from '../constants';
import { getReportCategoryValue } from '../constants';
import { isCustomerActivityCategory } from '../negotiationModel';
import { getReportCategoryIcon } from '../reportCatalog';
import { PILOT_REPORT_SECTIONS, pilotActivityLabel, type PilotReportCategory } from '../pilotReportCatalog';

export default function PilotDailyReport({ report, saving, proposalOpen, onAdjust, onProposal }: {
  report: DailyReport | null;
  saving: boolean;
  proposalOpen: boolean;
  onAdjust: (categoryId: string, delta: number) => void;
  onProposal: (category: PilotReportCategory) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-start">
      {PILOT_REPORT_SECTIONS.map(section => {
        const SectionIcon = getReportCategoryIcon(section.iconKey);
        const placement = section.id === 'promotion' ? 'xl:col-span-3' : section.id === 'reception' ? '' : 'xl:col-span-2';
        return <section key={section.id} aria-labelledby={`pilot-section-${section.id}`} className={`bg-white border border-slate-200 border-t-4 ${section.color} ${placement} rounded-xl overflow-hidden shadow-sm`}>
          <div className="px-4 py-4 border-b border-slate-200 bg-slate-50/60">
            <h3 id={`pilot-section-${section.id}`} className="flex items-center gap-2 text-base font-bold text-slate-800"><SectionIcon size={18} className="text-slate-500" />{section.title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{section.description}</p>
          </div>
          <div className={section.id === 'promotion' ? 'grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3' : ''}>
            {section.categories.map((category, index) => {
              const CategoryIcon = getReportCategoryIcon(category.iconKey);
              const value = report ? getReportCategoryValue(report, category.id) : 0;
              const requiresCustomer = isCustomerActivityCategory(category.id);
              const highlighted = ['smeg', 'emissSmeg', 'prevSmegTerzi', 'vitarivConsegna', 'contattiEnergia', 'longevityCare'].includes(category.id);
              const label = pilotActivityLabel(category);
              const newGroup = category.group && category.group !== section.categories[index - 1]?.group;
              return <Fragment key={category.id}>
                {newGroup && <h4 className="col-span-full px-4 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">{category.group}</h4>}
                <div className={`px-3 py-3 min-h-[76px] flex items-center justify-between gap-2 border-b last:border-b-0 ${highlighted ? 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100/70' : 'border-slate-100 hover:bg-slate-50/60'}`}>
                  <div className="flex items-start gap-2 min-w-0">
                    <CategoryIcon size={16} className={`mt-0.5 shrink-0 ${highlighted ? 'text-emerald-600' : 'text-slate-400'}`} />
                    <div><p className={`text-sm font-semibold leading-tight ${highlighted ? 'text-emerald-900' : 'text-slate-800'}`}>{category.label}</p><p className="text-[11px] text-slate-500 mt-1 leading-tight">{category.activity}</p></div>
                  </div>
                  <div className={`flex items-center rounded-lg p-0.5 shrink-0 ${highlighted ? 'bg-emerald-100/80' : 'bg-slate-100'}`}>
                    {!requiresCustomer && <button type="button" aria-label={`Diminuisci ${label}`} onClick={() => onAdjust(category.id, -1)} disabled={value === 0 || saving || !report} className="w-8 h-9 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-red-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-25"><Minus size={15} /></button>}
                    <output aria-label={`Totale ${label}`} className="w-8 text-center font-bold text-base text-slate-800 tabular-nums">{value}</output>
                    <button type="button" aria-label={requiresCustomer ? `Nuova registrazione: ${label}` : `Aumenta ${label}`} title={requiresCustomer ? 'Apri la scheda cliente per registrare l’attività' : `Aumenta ${label}`} onClick={() => requiresCustomer ? onProposal(category) : onAdjust(category.id, 1)} disabled={saving || proposalOpen || !report} className="w-8 h-9 inline-flex items-center justify-center rounded-md text-[#003781] hover:bg-white focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-25"><Plus size={15} /></button>
                  </div>
                </div>
              </Fragment>;
            })}
          </div>
        </section>;
      })}
    </div>

  );
}
