/**
 * View state shared by the server page (which parses it from the URL) and the
 * client component (which owns it). Plain module: no 'use client', so the
 * server can read the constant lists.
 */
import type { FunnelStage } from '@/lib/schemas';

export type View = 'overview' | 'push' | 'save' | 'journeys' | 'archive';
export type Period = 30 | 90 | 365 | 0;
export type Grain = 'monthly' | 'weekly';
export type Compare = 'previous' | 'year' | 'none';
export type Lane = 'organic' | 'ads' | 'crm';

export const VIEWS: View[] = ['overview', 'push', 'save', 'journeys', 'archive'];
export const PERIOD_IDS: Period[] = [30, 90, 365, 0];
export const GRAINS: Grain[] = ['monthly', 'weekly'];
export const COMPARES: Compare[] = ['previous', 'year', 'none'];
export const LANES: Lane[] = ['organic', 'ads', 'crm'];

export type DashboardInitial = {
  view?: View;
  stage?: FunnelStage;
  period?: Period;
  grain?: Grain;
  compare?: Compare;
  lane?: Lane;
  lead?: string;
};

/** Pick a value from `list` whose string form equals `v`, else undefined. */
export function oneOf<T extends string | number>(list: readonly T[], v: string | undefined): T | undefined {
  return list.find((x) => String(x) === v);
}
