/**
 * The operator — the one person this OS runs for. Set GLADOS_OPERATOR_NAME in
 * .env.local; every surface that names the operator reads it from here.
 */
export const OPERATOR_NAME = process.env.GLADOS_OPERATOR_NAME?.trim() || 'Operator';
