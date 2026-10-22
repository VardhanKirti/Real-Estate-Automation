// Vitest stand-in for next/font/local: the real implementation is a Next.js
// compiler transform, so under vitest we return the same shape it produces.
export default function localFont(_opts: unknown) {
  return { className: 'font-stub', variable: 'font-stub', style: { fontFamily: 'font-stub' } };
}
