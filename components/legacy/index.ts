/**
 * Bennett Legacy kit (FounderOS ui merge SPEC §2.5): ports of FounderOS
 * `kit/*` over the --l-* tokens (app/globals.css, L0 block). Every element
 * carries data-l="<Name>"; scripts/l-audit.mjs checks the rendered pages.
 * Specimen: /dev/l-kit.
 */
export { Slab, SlabTitle, SlabCard, InsightCard, Label } from './Surfaces';
export { Chip, Badge, Dot, Kbd } from './Status';
export { BigStat } from './Numbers';
export { CountUp } from './CountUp';
export { MeterStack, VolumeMeter, StepLine, DotMatrix } from './Charts';
export { Pressable, ToggleChip } from './Controls';
export { ConductorEmblem, OsMark } from './Marks';
export { LEmpty, LUnconfigured, LError, LSkeleton, LSampleChip } from './States';
export { LegacySlab, legacyEyebrow } from './LegacySlab';
export * from './format';
export { LDialog, LAvatar, LSwitch } from './Dialog';
