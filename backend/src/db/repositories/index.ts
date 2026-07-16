/**
 * Lightweight repository facades over the portable query layer.
 * Business logic should prefer these (or qGet/qAll/qRun) over provider-specific APIs.
 */
export { qGet, qAll, qRun, qExec, qTransaction, isSqlite, isPostgres } from "../query.js";
export { dbAsync } from "../index.js";
export type { UserRow } from "../index.js";
