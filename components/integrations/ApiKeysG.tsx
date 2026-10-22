'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { GButton, GCard, GErrorLine, GInput, GSectionHeader, GSkeleton } from '@/components/g';
import { useApiKeys } from '@/components/ApiKeys';
import type { KeyStatus } from '@/lib/keys';

/**
 * API keys under the GladOS style (SPEC S05 F05.73): one card per group, rows
 * with the env name (mono, it is code), a state dot, the masked value or
 * "not set", and Set / Rotate. Groups over four rows show the first four and
 * "Show N more". Values are never echoed back.
 */

const FOLD = 4;

function Slot({ slot, editing, onEdit, value, setValue, save, saved }: {
  slot: KeyStatus;
  editing: boolean;
  onEdit: () => void;
  value: string;
  setValue: (v: string) => void;
  save: (envVar: string) => void;
  saved: boolean;
}) {
  return (
    <li className="kg-key">
      <div className="kg-key-row">
        <span className="kg-dot" data-on={slot.present || undefined} aria-label={slot.present ? 'Set' : 'Not set'} role="img" />
        <code className="kg-key-name" data-mono-ok="" title={slot.envVar}>
          {slot.envVar}
        </code>
        <span className="kg-key-val" data-mono-ok={slot.present ? '' : undefined}>
          {slot.present ? slot.masked : 'not set'}
        </span>
        {saved && <Check size={12} strokeWidth={2} aria-label="Saved" />}
        <GButton variant="sm" size="compact" onClick={onEdit} aria-expanded={editing} aria-label={`${editing ? 'Cancel' : slot.present ? 'Rotate' : 'Set'} ${slot.envVar}`}>
          {editing ? 'Cancel' : slot.present ? 'Rotate' : 'Set'}
        </GButton>
      </div>
      {editing && (
        <div className="kg-key-edit">
          <GInput
            type="password"
            autoFocus
            size="compact"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save(slot.envVar)}
            placeholder={slot.hint ?? 'Paste value'}
            aria-label={`New value for ${slot.envVar}`}
          />
          <GButton variant="ink" size="compact" onClick={() => save(slot.envVar)} disabled={!value.trim()} disabledReason="Paste a value first">
            Save
          </GButton>
        </div>
      )}
    </li>
  );
}

function Group({ group, slots, api }: { group: string; slots: KeyStatus[]; api: ReturnType<typeof useApiKeys> }) {
  const [all, setAll] = useState(false);
  const shown = all || slots.length <= FOLD ? slots : slots.slice(0, FOLD);
  const set = slots.filter((s) => s.present).length;
  return (
    <GCard as="section" p={20} className="kg-keygroup" aria-label={`${group} keys`}>
      <div className="kg-keygroup-head">
        <h3 className="kg-keygroup-title">{group}</h3>
        <span className="kg-cap">
          {set} of {slots.length} set
        </span>
      </div>
      <ul className="kg-keys">
        {shown.map((slot) => (
          <Slot
            key={slot.envVar}
            slot={slot}
            editing={api.editing === slot.envVar}
            onEdit={() => {
              api.setEditing(api.editing === slot.envVar ? null : slot.envVar);
              api.setValue('');
              api.setError(null);
            }}
            value={api.value}
            setValue={api.setValue}
            save={(v) => void api.save(v)}
            saved={api.savedVar === slot.envVar}
          />
        ))}
      </ul>
      {slots.length > FOLD && (
        <GButton variant="sm" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Show fewer' : `Show ${slots.length - FOLD} more`}
        </GButton>
      )}
    </GCard>
  );
}

export function ApiKeysG() {
  const api = useApiKeys();
  return (
    <section className="kg-section" aria-labelledby="keys-head">
      <GSectionHeader
        size={22}
        id="keys-head"
        title="API keys"
        caption={
          <>
            Stored in <code data-mono-ok="">.env.local</code> (gitignored), applied live. Values show masked; a secret is never echoed back.
          </>
        }
      />
      {api.error && <GErrorLine align="left">{api.error}</GErrorLine>}
      {!api.loaded && !api.error ? (
        <div className="kg-grid-3">
          {[0, 1, 2].map((i) => (
            <GSkeleton key={i} shape="card" height={180} />
          ))}
        </div>
      ) : (
        <div className="kg-grid-3">
          {api.groups.map(([group, slots]) => (
            <Group key={group} group={group} slots={slots} api={api} />
          ))}
        </div>
      )}
    </section>
  );
}
