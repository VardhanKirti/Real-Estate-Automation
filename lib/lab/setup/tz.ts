/**
 * "Local time" everywhere in the Lab: GLADOS_TZ (IANA) when set, else Intl's resolved zone (08.5.1).
 * Moved out of lib/lab/setup/jobs.ts by lane R (jobs.ts re-exports it) so job modules can read the
 * zone without importing the LAB_JOBS table they are registered in (no import cycle).
 */
export function labTz(env: Record<string, string | undefined> = process.env): string {
  const tz = env.GLADOS_TZ?.trim();
  if (tz) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: tz });
      return tz;
    } catch {
      // an invalid zone falls through to the machine zone
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
