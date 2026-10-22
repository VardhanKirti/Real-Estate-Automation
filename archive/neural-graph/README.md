# Neural graph view — archived 2026-10-09

The Neural tab on `/brain`'s knowledge graph drew the agents, people, tools
and tasks as a left-to-right neural network. It was cut on 2026-10-09
(GladOS UI spec S05 F05.13, honesty fix H34) because its strands claimed a
meaning they did not have: every strand's weight came from a hash of the two
node ids (`neuralLayout` in `neural-layout.ts`), and the sign of that number
coloured the strand as a positive or negative signal. Nothing in the data
measures either.

## What is still live
- `components/KnowledgeGraph.tsx` (the Radial view), `components/KnowledgeDetail.tsx`,
  `components/GraphDirectory.tsx`, `lib/knowledge-graph.ts`
- `components/BrainGraphView.tsx`, now a lazy wrapper around the Radial view only

## What this folder holds
- `NeuralGraph.tsx`, `NeuralDetail.tsx`: the view and its side panel, as they were
- `neural-layout.ts`: the layer layout and the hash-derived strand weights
- `neural-layout.test.ts`: its unit test (vitest only runs `tests/`, so it is
  parked here, not run)

Imports inside this folder point at `@/archive/neural-graph/…` so it still
type-checks against the live libraries.

## To restore
Only restore it with honest strands: draw them uncoloured with no weight, or
drive the weight from a real measure (for example run counts between an agent
and a tool).
1. `git mv archive/neural-graph/NeuralGraph.tsx archive/neural-graph/NeuralDetail.tsx components/`
2. `git mv archive/neural-graph/neural-layout.ts lib/` and `git mv archive/neural-graph/neural-layout.test.ts tests/`
3. Point the imports back: `@/archive/neural-graph/neural-layout` → `@/lib/neural-layout`,
   `@/archive/neural-graph/NeuralDetail` → `@/components/NeuralDetail`
4. `components/BrainGraphView.tsx`: bring back the lazy `NeuralGraph` import
   (skeleton at `aspectRatio: '1200 / 640'`) and the Radial / Neural switch
5. `tests/code-splitting.test.ts`: restore the NeuralGraph lazy-load assertions

Every step above is the inverse of commit "Brain: cut the Neural view".
