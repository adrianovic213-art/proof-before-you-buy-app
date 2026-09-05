import type { InvestigationReport } from "@/types/investigation";

/** Durée de validité d'une entrée de cache : 30 jours en millisecondes. */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Normalise une requête utilisateur en clé de cache stable :
 * minuscules, espaces superflus supprimés, caractères spéciaux retirés.
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "");
}

/**
 * Entrée de cache : le rapport d'investigation, accompagné de sa date de
 * mise en cache et de sa date d'expiration (format ISO 8601).
 */
export interface CacheEntry {
  /** Le rapport d'investigation mis en cache. */
  report: InvestigationReport;
  /** Date de mise en cache, en ISO 8601. */
  cachedAt: string;
  /** Date d'expiration (cachedAt + 30 jours), en ISO 8601. */
  expiresAt: string;
}

/**
 * Contrat d'abstraction d'un cache de rapports d'investigation.
 * Permet de remplacer facilement l'implémentation (mémoire → Turso).
 */
export interface CacheStore {
  /** Récupère l'entrée associée à une clé normalisée, ou null si absente. */
  get(key: string): Promise<CacheEntry | null>;
  /** Enregistre une entrée sous une clé normalisée. */
  set(key: string, entry: CacheEntry): Promise<void>;
  /** Indique si l'entrée a dépassé sa date d'expiration. */
  isExpired(entry: CacheEntry): Promise<boolean>;
}

/**
 * Implémentation temporaire en mémoire (simple Map), destinée à être
 * remplacée par une version connectée à Turso. Aucune logique métier
 * ne doit dépendre de la Map en dehors de cette classe.
 */
export class InMemoryCacheStore implements CacheStore {
  private entries = new Map<string, CacheEntry>();

  async get(key: string): Promise<CacheEntry | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, entry: CacheEntry): Promise<void> {
    this.entries.set(key, entry);
  }

  async isExpired(entry: CacheEntry): Promise<boolean> {
    return Date.now() > new Date(entry.expiresAt).getTime();
  }
}

/**
 * Récupère le rapport associé à une requête, s'il existe et n'est pas expiré.
 * Retourne null si l'entrée est absente ou expirée.
 */
export async function getCachedReport(
  store: CacheStore,
  query: string,
): Promise<InvestigationReport | null> {
  const entry = await store.get(normalizeQuery(query));
  if (!entry) return null;
  if (await store.isExpired(entry)) return null;
  return entry.report;
}

/**
 * Sauvegarde un rapport en cache pour une requête donnée, avec les dates
 * de mise en cache et d'expiration (cachedAt + 30 jours).
 */
export async function cacheReport(
  store: CacheStore,
  query: string,
  report: InvestigationReport,
): Promise<void> {
  const cachedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  await store.set(normalizeQuery(query), { report, cachedAt, expiresAt });
}