'use client';

import { useState } from 'react';
import { Bot } from 'lucide-react';

/**
 * Agent photo or the generic stroke icon, on kit tokens (GladOS tree only;
 * the Classic tree keeps components/AgentAvatar.tsx). Never an emoji, never
 * a fake face.
 */
export function AgentFace({ src, name, size = 32 }: { src: string | null | undefined; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span className="wg-face" style={{ width: size, height: size }} aria-hidden>
        <Bot size={Math.max(12, Math.round(size * 0.5))} strokeWidth={1.6} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="wg-face" src={src} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setFailed(true)} />
  );
}
