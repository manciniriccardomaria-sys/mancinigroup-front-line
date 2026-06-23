import React from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { CallCategory } from '../callCenter';
import { isCallCategoryEnabled } from '../callWorkflowConfig';

export type CallCategorySelection =
  | CallCategory
  | `campaign:${string}`;

export type CampaignFilterOption = {
  id: string;
  label: string;
};

const ALL_CATEGORY_OPTIONS: Array<{
  id: CallCategorySelection;
  label: string;
}> = [
  { id: 'scadenza_rata', label: 'Scadenze rata' },
  { id: 'scadenza_annuale', label: 'Scadenze annuali' },
  { id: 'winback', label: 'Winback' },
];

const CATEGORY_OPTIONS = ALL_CATEGORY_OPTIONS.filter(option =>
  isCallCategoryEnabled(option.id)
);

export default function CallCategoryFilter({
  selected,
  onChange,
  campaigns = [],
}: {
  selected: CallCategorySelection[];
  onChange: (selected: CallCategorySelection[]) => void;
  campaigns?: CampaignFilterOption[];
}) {
  const campaignOptions = campaigns.length > 0
    ? campaigns.map(campaign => ({
        id: `campaign:${campaign.id}` as CallCategorySelection,
        label: campaign.label,
      }))
    : [{ id: 'campagna' as CallCategorySelection, label: 'Campagne' }];
  const options = [...campaignOptions, ...CATEGORY_OPTIONS];
  const label = selected.length === 0
    ? 'Tutte le categorie'
    : selected.length === 1
      ? options.find(option => option.id === selected[0])?.label
      : `${selected.length} categorie`;

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none focus:ring-2 focus:ring-[#003781] flex items-center justify-between gap-3 min-w-48">
        <span>{label}</span>
        <ChevronDown size={16} className="text-slate-400 shrink-0" />
      </summary>

      <div className="absolute right-0 z-30 mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-xl p-2">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-md text-sm text-left ${
            selected.length === 0
              ? 'bg-blue-50 text-[#003781] font-bold'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Tutte le categorie
          {selected.length === 0 && <Check size={16} />}
        </button>

        <div className="my-1 border-t border-slate-100" />

        {campaignOptions.length > 0 && (
          <p className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase text-slate-400">
            Campagne
          </p>
        )}

        {campaignOptions.map(option => {
          const checked = selected.includes(option.id);

          return (
            <label
              key={option.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm ${
                checked
                  ? 'bg-blue-50 text-[#003781] font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(
                  checked
                    ? selected.filter(category => category !== option.id)
                    : [...selected, option.id]
                )}
                className="w-4 h-4 accent-[#003781]"
              />
              {option.label}
            </label>
          );
        })}

        <div className="my-1 border-t border-slate-100" />
        <p className="px-3 pt-1 pb-1 text-[10px] font-bold uppercase text-slate-400">
          Altre categorie
        </p>

        {CATEGORY_OPTIONS.map(option => {
          const checked = selected.includes(option.id);

          return (
            <label
              key={option.id}
              className={`flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm ${
                checked
                  ? 'bg-blue-50 text-[#003781] font-semibold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(
                  checked
                    ? selected.filter(category => category !== option.id)
                    : [...selected, option.id]
                )}
                className="w-4 h-4 accent-[#003781]"
              />
              {option.label}
            </label>
          );
        })}
      </div>
    </details>
  );
}
