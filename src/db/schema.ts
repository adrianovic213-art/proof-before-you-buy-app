import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Cache des investigations : la clé est la requête normalisée,
 * le rapport est l'InvestigationReport sérialisé en JSON.
 */
export const investigationCache = sqliteTable("investigation_cache", {
  key: text("key").primaryKey(),
  report: text("report"),
  cachedAt: text("cachedAt"),
  expiresAt: text("expiresAt"),
});