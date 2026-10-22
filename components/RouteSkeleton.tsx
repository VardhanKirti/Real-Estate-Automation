/**
 * Loading state for the routes whose server render waits on live third-party calls (perf): their
 * `loading.tsx` re-exports this, so a click shows the page frame at once while the render finishes;
 * the sidebar, topbar and Wizard dock stay mounted. Static shapes only: no numbers, no copy that
 * could read as data. Styled for both looks from tokens (app/globals.css, `.route-skel`).
 *
 * Deliberately NOT a root app/loading.tsx: React holds back content that resolves within 300ms of a
 * shown fallback (FALLBACK_THROTTLE_MS), so a boundary on a route that renders in 20ms makes every
 * first visit take ~300ms. Fast routes get the NavProgress bar instead (components/NavProgress.tsx).
 * Content Lab has its own frame-shaped one (app/lab/loading.tsx).
 */
export function RouteSkeleton() {
  return (
    <div className="route-skel" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <div className="route-skel-head" aria-hidden="true">
        <span className="route-skel-bar route-skel-title" />
        <span className="route-skel-bar route-skel-sub" />
      </div>
      <div className="route-skel-tiles" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="route-skel-card route-skel-tile" />
        ))}
      </div>
      <div className="route-skel-panels" aria-hidden="true">
        <span className="route-skel-card route-skel-panel" />
        <span className="route-skel-card route-skel-panel" />
      </div>
    </div>
  );
}

/**
 * The same static shape for one card whose data streams in behind `<Suspense>` while the rest of
 * the page (SQLite reads) is already on screen (SPEC 4.1 a4). aria-busy, so a settled check waits
 * for the real card.
 */
export function CardSkeleton({ height = 340, label = 'Loading' }: { height?: number; label?: string }) {
  return (
    <div className="route-skel-card" style={{ height }} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
    </div>
  );
}

export default RouteSkeleton;
