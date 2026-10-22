/** The Aurora backdrop (02 section 3): rendered once per Lab page as the first child of the .lab root. */
export type AuroraProps = { className?: string };

export function Aurora({ className }: AuroraProps) {
  return <div className={['lab2-aurora', className].filter(Boolean).join(' ')} data-lab="Aurora" data-g="LabAurora" aria-hidden="true" />;
}
