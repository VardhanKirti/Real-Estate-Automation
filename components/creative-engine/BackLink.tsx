'use client';

import { Btn, EngineSkin } from '@/components/creative-engine/skin';

/** The page's way back to AdPilot: a button-styled link (GButton under the kit, the paper .ae-btn under Classic). */
export function BackToAdPilot({ g }: { g: boolean }) {
  return (
    <EngineSkin g={g}>
      <Btn href="/adpilot" link>‹ AdPilot</Btn>
    </EngineSkin>
  );
}
