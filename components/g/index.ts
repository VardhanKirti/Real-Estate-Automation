/**
 * The G kit (SPEC S00 §5.0, X1, GP3): the only primitives a GladOS tree
 * renders. Each carries `data-g="<Name>"` for tests and audits; every colour
 * is a --g-* token (app/globals.css, "G0 tokens" and "1d G kit" blocks).
 *
 * Part 1 (lane 1d): frame, type, surfaces, numbers, controls, inputs, lists,
 * states, overlays. Part 2 (lane 1e) adds the data-viz primitives.
 */
export { GPage, GDisplay, GSectionHeader, GEyebrow } from './Frame';
export type { GPageProps, GDisplayProps, GSectionHeaderProps } from './Frame';

export { GCard, GCardRaised, GWell, GHeroCard } from './Surfaces';
export type { GCardProps, GHeroCardProps } from './Surfaces';

export { GDotNumber, GBigNumber, GDelta, GStat, deltaFor } from './Numbers';
export type { GDotNumberProps, GBigNumberProps, GDeltaProps, GStatProps, GStatState, DotSize, DotTone } from './Numbers';

export { GButton, GBadge, GTag, GChip, GSegmented, GTabs, GToggle, GCheck, GPill, GPillNav } from './Controls';
export type {
  GButtonProps,
  GButtonVariant,
  GButtonSize,
  GTagProps,
  GTagTone,
  GChipProps,
  GOption,
  GSegmentedProps,
  GTab,
  GTabsProps,
  GToggleProps,
  GCheckProps,
  GPillProps,
  GPillNavProps,
} from './Controls';

export { GInput, GTextarea, GSelect, GDateTime, GField, GSearch, GAsk, GSwatch } from './Inputs';
export type { GInputProps, GTextareaProps, GSelectProps, GDateTimeProps, GFieldProps, GSearchProps, GAskProps, GSwatchProps } from './Inputs';

export { GList, GRow, GTable, GKeyValue } from './Lists';
export type { GListProps, GRowProps, GColumn, GTableProps, GKeyValueProps } from './Lists';

export { GEmpty, GProgress, GSkeleton, GErrorLine, GSampleBadge } from './States';
export type { GEmptyProps, GSkeletonProps } from './States';

export { GSheet, GDrawer, GDialog, GPopover, GMenu, GTooltip, GToast, ToastProvider, useToast, TOOLTIP_DELAY_MS } from './Overlays';
export type { GSheetProps, GDrawerProps, GDialogProps, GPopoverProps, PopoverTriggerProps, GMenuItem, GMenuProps, GTooltipProps } from './Overlays';

/** The primitives this part of the kit ships (X1 rows owned by lane 1d). tests/g-kit.test.ts holds this to X1. */
export const G_KIT_PART1 = [
  'GPage',
  'GDisplay',
  'GSectionHeader',
  'GEyebrow',
  'GCard',
  'GCardRaised',
  'GWell',
  'GHeroCard',
  'GStat',
  'GDotNumber',
  'GBigNumber',
  'GDelta',
  'GButton',
  'GPill',
  'GPillNav',
  'GChip',
  'GSegmented',
  'GTabs',
  'GBadge',
  'GTag',
  'GToggle',
  'GCheck',
  'GInput',
  'GSelect',
  'GField',
  'GSearch',
  'GTextarea',
  'GDateTime',
  'GAsk',
  'GSwatch',
  'GList',
  'GRow',
  'GTable',
  'GKeyValue',
  'GSheet',
  'GDrawer',
  'GDialog',
  'GPopover',
  'GMenu',
  'GTooltip',
  'GToast',
  'GEmpty',
  'GProgress',
  'GSkeleton',
  'GErrorLine',
  'GSampleBadge',
] as const;

/** Part 2 (lane 1e): the data viz primitives (G_VIZ_PRIMITIVES in ./viz). */
export * from './viz';
