/** Shared identifier-safety helpers for the backup/restore modules. */

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function assertSafeIdent(name: string, label = "identifier"): string {
  if (!IDENT.test(name)) throw new Error(`Invalid ${label}: ${name}`);
  return name;
}

export function quoteIdent(name: string): string {
  return `"${assertSafeIdent(name).replace(/"/g, '""')}"`;
}
