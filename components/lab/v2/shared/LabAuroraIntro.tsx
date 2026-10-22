'use client';
import { useLabIntro } from './motion/useLabIntro';

/** Plays the `aurora` intro scope on the first /lab page of the session (03.3.2). Renders nothing. */
export function LabAuroraIntro() {
  useLabIntro('aurora');
  return null;
}
