import { eq, sql } from "drizzle-orm";
import type { createDb } from "@/db/client";
import { investigationCache } from "@/db/schema";
import type { CacheEntry, CacheStore } from "@/lib/investigationCache";
import type { InvestigationReport } from "@/types/investigation";

/** Type de l'instance Drizzle produite par src/db/client.ts. */
type Database = ReturnType<typeof createDb>;

/**
 * Implémentation de CacheStore connectée à Turso via Drizzle.
 *
 * Le rapport est sérialisé en JSON dans la colonne `report` (table
 * `investigation_cache`), avec `cachedAt` et `expiresAt` en ISO 8601.
 */
export class TursoCacheStore implements CacheStore {
  constructor(private readonly db: Database) {}

  /**
   * Crée la table `investigation_cache` si elle n'existe pas encore.
   * Idempotent : sans effet si la table est déjà présente.
   */
  async init(): Promise<void> {
    await this.db.run(sql`
      CREATE TABLE IF NOT EXISTS investigation_cache (
        key TEXT PRIMARY KEY,
        report TEXT NOT NULL,
        cachedAt TEXT NOT NULL,
        expiresAt TEXT NOT NULL
      );
    `);
  }

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const row = await this.db
        .select()
        .from(investigationCache)
        .where(eq(investigationCache.key, key))
        .get();

      if (!row || !row.report) return null;

      return {
        report: JSON.parse(row.report) as InvestigationReport,
        cachedAt: row.cachedAt ?? "",
        expiresAt: row.expiresAt ?? "",
      };
    } catch (error) {
      console.warn("[TursoCacheStore] Erreur cache :", error);
      return null;
    }
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    const values = {
      key,
      report: JSON.stringify(entry.report),
      cachedAt: entry.cachedAt,
      expiresAt: entry.expiresAt,
    };

    try {
      await this.db.run(sql`
        INSERT OR REPLACE INTO investigation_cache (key, report, cachedAt, expiresAt)
        VALUES (${key}, ${values.report}, ${values.cachedAt}, ${values.expiresAt});
      `);
    } catch (error) {
      console.warn("[TursoCacheStore] Erreur cache :", (error as any)?.cause?.message || (error as any)?.cause || error);
    }
  }

  async isExpired(entry: CacheEntry): Promise<boolean> {
    return Date.now() > new Date(entry.expiresAt).getTime();
  }
}