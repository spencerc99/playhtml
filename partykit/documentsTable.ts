// ABOUTME: Names the Supabase table a server stores room documents in.
// ABOUTME: Production and staging share one project, so each must be told its table and may not use the other's.

export const DOCUMENTS_TABLES = ["documents", "documents_staging"] as const;

export type DocumentsTable = (typeof DOCUMENTS_TABLES)[number];

const TABLE_BY_DEPLOYMENT: Record<"staging" | "production", DocumentsTable> = {
  staging: "documents_staging",
  production: "documents",
};

/**
 * Read the configured table name. There is no default: a server that was not
 * told its table must fail instead of quietly writing to production's.
 */
export function parseDocumentsTable(value: unknown): DocumentsTable {
  if (
    typeof value === "string" &&
    (DOCUMENTS_TABLES as readonly string[]).includes(value)
  ) {
    return value as DocumentsTable;
  }
  throw new Error(
    `DOCUMENTS_TABLE must be one of ${DOCUMENTS_TABLES.join(", ")}, got ${JSON.stringify(value)}.`,
  );
}

type Deployment = "staging" | "production" | "local";

/**
 * Which deployment a request reached, judged by its hostname. The hostname
 * comes from the Worker's routes, so it cannot drift with the table setting.
 */
export function getDeploymentForHostname(hostname: string): Deployment {
  if (
    hostname === "api-staging.playhtml.fun" ||
    hostname.startsWith("playhtml-staging.")
  ) {
    return "staging";
  }
  if (hostname === "api.playhtml.fun" || hostname.startsWith("playhtml.")) {
    return "production";
  }
  return "local";
}

/**
 * Returns why this request must be refused, or null when the configured table
 * belongs to the deployment the request reached. Local servers may use either.
 */
export function getDocumentsTableError(
  hostname: string,
  configuredTable: unknown,
): string | null {
  let table: DocumentsTable;
  try {
    table = parseDocumentsTable(configuredTable);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  const deployment = getDeploymentForHostname(hostname);
  if (deployment === "local") return null;
  const expected = TABLE_BY_DEPLOYMENT[deployment];
  if (table === expected) return null;
  return `The ${deployment} server must store room documents in ${expected}, but DOCUMENTS_TABLE is ${table}.`;
}
