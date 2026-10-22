import { AboutButton } from '@/components/system-g/AboutButton';

/**
 * /brain "About this page" (S05 F05.3, F05.17): the Pipeline prose and the
 * Query path explainer, moved off the working surface word for word.
 */
export function BrainAbout({ storeShort }: { storeShort: string }) {
  return (
    <AboutButton>
      <h3>1 · Markdown brain-store</h3>
      <p>
        <code>{storeShort}</code>: plain <code>.md</code> files, the source of truth. <code>engine sync</code> walks the git repo
        and pushes changed pages up.
      </p>
      <h3>2 · engine CLI</h3>
      <p>Chunk, embed, route: the engine between disk and database. Its health and checks open from the Doctor card.</p>
      <h3>3 · Supabase Postgres + pgvector</h3>
      <p>
        Each page is split into chunks; every chunk gets a ZeroEntropy embedding stored in a <code>vector</code> column.
        Postgres holds both the text (tsvector) and the vectors, so one database answers keyword and semantic queries.
      </p>
      <p>
        Free tier pauses on idle — when hybrid queries fail, unpause from the Supabase dashboard. The brain-store on disk
        keeps working regardless.
      </p>
      <h3>Query path</h3>
      <p>
        What happens when an agent calls <code>engine query</code> — hybrid retrieval with an honest fallback.
      </p>
      <ol>
        <li>Question: natural-language query from you or an agent run.</li>
        <li>Query expansion: the CLI rewrites the question into search variants (skip with --no-expand).</li>
        <li>Keyword search: Postgres tsvector full-text match over chunk text.</li>
        <li>Vector search: pgvector nearest-neighbor over ZeroEntropy embeddings.</li>
        <li>RRF fusion: reciprocal-rank fusion merges both result lists into one ranking.</li>
        <li>Ranked snippets: top pages with snippets, returned to the agent.</li>
      </ol>
      <p>
        Fallback, local grep: if Supabase is paused or unreachable, the OS greps the markdown brain-store directly — fewer
        smarts, zero downtime.
      </p>
    </AboutButton>
  );
}
