/**
 * The product name and mark this deployment shows. One codebase ships as two
 * products: the operator's own instance (GLADOS_BRAND=glados) and the
 * invite-only client build, which is the default so a fresh clone needs no
 * setting. next.config.mjs inlines GLADOS_BRAND at build, so this reads the
 * same on the server and in the browser.
 */
export type Brand = { id: 'glados' | 'founderos' | 'realestate'; name: string; title: string; mark: string };

const BRANDS: Record<Brand['id'], Brand> = {
  glados: { id: 'glados', name: 'GladOS', title: 'GLADOS', mark: '/brand/glados-mark.png' },
  founderos: { id: 'founderos', name: 'FounderOS', title: 'FOUNDEROS', mark: '/brand/founderos-mark.png' },
  realestate: { id: 'realestate', name: 'Real Estate Automation', title: 'REAL ESTATE AUTOMATION', mark: '/brand/realestate-mark.png' },
};

export function brandFor(raw: string | undefined): Brand {
  const key = raw?.trim().toLowerCase();
  if (key === 'glados') return BRANDS.glados;
  if (key === 'realestate') return BRANDS.realestate;
  return BRANDS.founderos;
}

export const BRAND: Brand = brandFor(process.env.GLADOS_BRAND);
