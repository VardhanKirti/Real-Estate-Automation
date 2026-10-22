'use client';

import { AudioLines, Film, Image as ImageIcon, ImagePlay, Megaphone, Scissors, UserRound, Wand2 } from 'lucide-react';
import { SectionHead } from '@/components/terminal';
import { CONTENT_TOOLS, type ContentToolKey } from '@/lib/content-schema';
import { findModel, modelsByFamily } from '@/lib/higgsfield/catalog';
import { requestCompose } from '@/lib/content-compose';

/**
 * The eight tool cards behind the Composer — each one is a preset (a family
 * filter plus a default model), never a separate form implementation.
 * Clicking a card opens the Composer through the compose bus.
 */

const TOOL_ICON: Record<ContentToolKey, typeof ImageIcon> = {
  image: ImageIcon,
  video: Film,
  thumbnail: ImagePlay,
  avatar: UserRound,
  clips: Scissors,
  enhance: Wand2,
  speak: AudioLines,
  ads: Megaphone,
};

export function CreateGrid() {
  return (
    <div>
      <SectionHead label="Create" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CONTENT_TOOLS.map((tool) => {
          const Icon = TOOL_ICON[tool.key];
          const model = findModel(tool.defaultModel);
          const familyCount = modelsByFamily(tool.family).length;
          return (
            <button
              key={tool.key}
              type="button"
              onClick={() => requestCompose({ toolKey: tool.key })}
              className="hoverable glass-panel flex flex-col items-start gap-3 p-5 text-left"
            >
              <span className="grid h-9 w-9 place-items-center rounded-md-t border border-[rgb(var(--mist-rgb) / 0.14)] bg-black/20 text-os-accent">
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <span className="text-[14.5px] font-medium text-os-text">{tool.label}</span>
              <span className="text-[12px] leading-snug text-os-dim">{tool.blurb}</span>
              <span className="mt-auto pt-1 font-mono text-[11px] text-os-dim">
                {model?.name ?? tool.defaultModel} · {familyCount} model{familyCount === 1 ? '' : 's'}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
