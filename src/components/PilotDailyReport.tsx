import { Fragment, useEffect, useRef, useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
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
  const [choiceCategory, setChoiceCategory] = useState<PilotReportCategory | null>(null);

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 items-start">
      {PILOT_REPORT_SECTIONS.map(section => {
        const SectionIcon = getReportCategoryIcon(section.iconKey);
        const placement = section.id === 'promotion' ? 'lg:col-span-3' : section.id === 'reception' ? '' : 'lg:col-span-2';
        return <section key={section.id} aria-labelledby={`pilot-section-${section.id}`} className={`bg-white border border-slate-200 border-t-4 ${section.color} ${placement} rounded-xl overflow-hidden shadow-sm`}>
          <div className="px-3 py-2 border-b border-slate-200 bg-slate-50/60">
            <h3 id={`pilot-section-${section.id}`} title={section.description} className="flex items-center gap-2 text-sm font-bold text-slate-800"><SectionIcon size={16} className="text-slate-500" />{section.title}</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed lg:hidden">{section.description}</p>
          </div>
          <div className={section.id === 'promotion' ? 'grid grid-cols-1 lg:grid-cols-3' : section.id === 'reception' ? '' : 'grid grid-cols-1 lg:grid-cols-2'}>
            {section.categories.map((category: PilotReportCategory, index) => {
              const CategoryIcon = getReportCategoryIcon(category.iconKey);
              const value = report ? (category.proposalOptions ?? [category]).reduce((sum, option) => sum + getReportCategoryValue(report, option.id), 0) : 0;
              const requiresCustomer = Boolean(category.proposalOptions) || isCustomerActivityCategory(category.id);
              const label = pilotActivityLabel(category);
              const newGroup = category.group && category.group !== section.categories[index - 1]?.group;
              return <Fragment key={category.id}>
                {newGroup && <h4 className="col-span-full px-3 py-1 bg-slate-50 border-b border-slate-100 text-[10px] font-bold uppercase tracking-wider text-slate-500">{category.group}</h4>}
                <div className="px-2.5 py-1.5 min-h-12 lg:min-h-11 lg:py-1 flex items-center justify-between gap-1.5 border-b last:border-b-0 border-slate-100 hover:bg-slate-50/60">
                  <div className="flex items-start gap-1.5 min-w-0">
                    <CategoryIcon size={16} className="mt-0.5 shrink-0 text-slate-400" />
                    <div><p className="text-[13px] font-semibold leading-tight text-slate-800">{category.label}</p><p className="text-[11px] text-slate-500 mt-0.5 leading-tight">{category.activity}</p></div>
                  </div>
                  <div className="flex items-center rounded-lg p-0.5 shrink-0 bg-slate-100">
                    {!requiresCustomer && <button type="button" aria-label={`Diminuisci ${label}`} onClick={() => onAdjust(category.id, -1)} disabled={value === 0 || saving || !report} className="w-8 h-9 lg:w-7 lg:h-8 inline-flex items-center justify-center rounded-md text-slate-500 hover:bg-white hover:text-red-600 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-25"><Minus size={15} /></button>}
                    <output aria-label={`Totale ${label}`} className="min-w-7 px-0.5 text-center font-bold text-sm text-slate-800 tabular-nums">{value}</output>
                    <button type="button" aria-label={requiresCustomer ? `Nuova registrazione: ${label}` : `Aumenta ${label}`} title={category.proposalOptions ? 'Scegli tra Longevity Care e Lovia' : requiresCustomer ? 'Apri la scheda cliente per registrare l’attività' : `Aumenta ${label}`} onClick={() => category.proposalOptions ? setChoiceCategory(category) : requiresCustomer ? onProposal(category) : onAdjust(category.id, 1)} disabled={saving || proposalOpen || Boolean(choiceCategory) || !report} className="w-8 h-9 lg:w-7 lg:h-8 inline-flex items-center justify-center rounded-md text-[#003781] hover:bg-white focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-25"><Plus size={15} /></button>
                  </div>
                </div>
              </Fragment>;
            })}
          </div>
        </section>;
      })}
    </div>
    {choiceCategory && <ProposalChoiceDialog category={choiceCategory} onClose={() => setChoiceCategory(null)} onChoose={onProposal} />}
    </>
  );
}

function ProposalChoiceDialog({ category, onClose, onChoose }: {
  category: PilotReportCategory;
  onClose: () => void;
  onChoose: (category: PilotReportCategory) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="proposal-choice-title" onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl p-6 bg-white shadow-2xl backdrop:bg-slate-900/50">
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 id="proposal-choice-title" className="text-xl font-bold text-slate-800">{category.label}</h2>
        <p className="mt-1 text-sm text-slate-500">Scegli il prodotto per la nuova proposta.</p>
      </div>
      <button type="button" onClick={onClose} aria-label="Chiudi scelta prodotto" className="p-2 rounded-lg hover:bg-slate-100"><X size={20} /></button>
    </div>
    <div className="grid gap-3 mt-5">
      {category.proposalOptions?.map(option => {
        const Icon = getReportCategoryIcon(option.iconKey);
        return <button key={option.id} type="button" onClick={() => {
          dialogRef.current?.close();
          onClose();
          onChoose(option);
        }} className="flex items-center gap-3 w-full border border-slate-200 rounded-xl p-4 text-left font-semibold text-[#003781] hover:bg-blue-50 hover:border-blue-300 focus-visible:outline-2 focus-visible:outline-blue-600">
          <Icon size={20} />{option.label}
        </button>;
      })}
    </div>
  </dialog>;
}
