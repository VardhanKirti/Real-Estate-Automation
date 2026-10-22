import type { Framework } from '@/lib/creative-engine/schemas';

/**
 * Framework table — pure data, importable by client components. Each
 * framework declares its beats, the framing the writer gets per beat, and
 * the share of the duration each beat should take.
 */

export const FRAMEWORK_BANK: Record<Framework, { label: string; beats: { name: string; framing: string; share: number }[] }> = {
  'hook-show-demo-result-verdict': {
    label: 'Hook · Show · Demo · Result · Verdict',
    beats: [
      { name: 'Hook', framing: 'the line that stops the scroll, stated as a claim or a reversal', share: 0.15 },
      { name: 'Show', framing: 'the product enters the frame, one sentence of what it is', share: 0.15 },
      { name: 'Demo', framing: 'the one thing it does, shown not described', share: 0.3 },
      { name: 'Result', framing: 'what changed, in a number or a before/after', share: 0.25 },
      { name: 'Verdict', framing: 'the verdict plus the CTA in one breath', share: 0.15 },
    ],
  },
  'problem-agitate-solve': {
    label: 'Problem · Agitate · Solve',
    beats: [
      { name: 'Problem', framing: 'name the pain in the viewer\'s words', share: 0.25 },
      { name: 'Agitate', framing: 'what it costs them every week they leave it', share: 0.3 },
      { name: 'Solve', framing: 'the product as the way out, then the CTA', share: 0.45 },
    ],
  },
  'testimonial-arc': {
    label: 'Testimonial arc',
    beats: [
      { name: 'Before', framing: 'where they were, specific', share: 0.3 },
      { name: 'Turn', framing: 'the moment they tried it, why they doubted it', share: 0.25 },
      { name: 'After', framing: 'the result and the CTA', share: 0.45 },
    ],
  },
  'feature-walkthrough': {
    label: 'Feature walkthrough (4s · 7s · 4s)',
    beats: [
      { name: 'Hook', framing: 'the outcome of the feature as a claim', share: 0.27 },
      { name: 'Demo', framing: 'walk the feature, three concrete steps', share: 0.46 },
      { name: 'Kicker', framing: 'the payoff line and the CTA', share: 0.27 },
    ],
  },
  'premium-reveal': {
    label: 'Premium reveal (no person)',
    beats: [
      { name: 'Void', framing: 'the product alone, one superlative on screen', share: 0.3 },
      { name: 'Reveal', framing: 'the detail that justifies the price', share: 0.4 },
      { name: 'Close', framing: 'brand line and CTA', share: 0.3 },
    ],
  },
  'before-after': {
    label: 'Before / After',
    beats: [
      { name: 'Before', framing: 'the messy state', share: 0.35 },
      { name: 'After', framing: 'the clean state, the product in frame', share: 0.4 },
      { name: 'CTA', framing: 'one action', share: 0.25 },
    ],
  },
};
