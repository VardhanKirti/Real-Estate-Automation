'use client';

import { useState } from 'react';
import { FolderPlus, type LucideIcon } from 'lucide-react';
import type { Campaign } from '@/lib/content-campaigns';

/**
 * The tight action row shared by Production's delivered cards and the
 * Library's Generated cards — icon + label buttons, never a long menu.
 */
export function VerbButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={label}
      className="flex items-center justify-center gap-1.5 rounded-md-t border border-os-border-strong px-2 py-1.5 text-[11px] text-os-dim transition-colors hover:border-os-border hover:text-os-text disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      <span className="hidden truncate sm:inline">{label}</span>
    </button>
  );
}

/**
 * "Add to campaign" — a native select invisibly overlaid on a verb-shaped
 * button, so it reads as the fourth tight verb while still being a real
 * <select> under the hood. Resets after every pick; it is an action, not a
 * persistent field showing the current campaign.
 */
export function AddToCampaignVerb({
  campaigns,
  disabled = false,
  onPick,
}: {
  campaigns: Campaign[];
  disabled?: boolean;
  onPick: (campaignId: string) => void;
}) {
  const [resetKey, setResetKey] = useState(0);
  return (
    <label className="relative flex items-center justify-center gap-1.5 rounded-md-t border border-os-border-strong px-2 py-1.5 text-[11px] text-os-dim transition-colors hover:border-os-border hover:text-os-text has-[:disabled]:opacity-40">
      <FolderPlus className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
      <span className="hidden truncate sm:inline">Add to campaign</span>
      <select
        key={resetKey}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        defaultValue=""
        disabled={disabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const value = e.target.value;
          if (value) onPick(value);
          setResetKey((k) => k + 1);
        }}
      >
        <option value="" disabled>
          Add to campaign
        </option>
        {campaigns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );
}
