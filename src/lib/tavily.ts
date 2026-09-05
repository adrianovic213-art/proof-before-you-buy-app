/**
 * Client minimaliste pour l'API Tavily (recherche alignée sur le brief V1).
 *
 * Fournit une seule fonction, `searchWeb`, qui interroge l'API Tavily selon
 * les deux requêtes de l'Étape 1 du brief — tests pro & specs (`review`) et
 * signal utilisateur brut (`reddit`) — exécutées en parallèle, puis fusionne
 * leurs résultats. Le mode `basic` (1 crédit par recherche) respecte le budget
 * de 1000 crédits. La fonction est tolérante aux pannes : tout échec (réseau,
 * HTTP, parsing) renvoie un résultat vide plutôt que de lever une exception.
 */

/** Endpoint REST de l'API Tavily pour la recherche. */
const TAVILY_ENDPOINT = "https://api.tavily.com/search";

/** Résultat de recherche textuel renvoyé par l'API Tavily. */
export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/** Réponse agrégée de `searchWeb` : résultats textuels fusionnés et URLs d'images (désactivées). */
export interface TavilySearchResult {
  results: Array<{ title: string; url: string; content: string }>;
  images: string[];
}

/** Forme brute de la réponse JSON de l'API Tavily. */
interface TavilyResponse {
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
  }>;
  images?: unknown[];
}

/**
 * Normalise une URL en clé de correspondance : minuscules, sans protocole,
 * sans « www. » ni slash final. Sert à repérer les doublons inter-recherches.
 *
 * @param url - URL à normaliser.
 * @returns La clé normalisée de l'URL.
 */
function normaliserUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const hote = parsed.hostname.replace(/^www\./, "");
    const chemin = parsed.pathname.replace(/\/+$/, "");
    return `${hote}${chemin}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/**
 * Fusionne des listes de résultats en éliminant les doublons d'URLs.
 * La première occurrence de chaque URL est conservée.
 *
 * @param resultats - Résultats bruts des différentes requêtes.
 * @returns Les résultats fusionnés, dédupliqués et dans l'ordre d'origine.
 */
function fusionnerSansDoublons(resultats: SearchResult[]): SearchResult[] {
  const vues = new Set<string>();
  const fusionnes: SearchResult[] = [];

  for (const resultat of resultats) {
    const cle = normaliserUrl(resultat.url);
    if (vues.has(cle)) continue;
    vues.add(cle);
    fusionnes.push(resultat);
  }

  return fusionnes;
}

/**
 * Exécute une requête unique sur l'API Tavily et en extrait les résultats
 * textuels. Tolérante aux pannes : tout échec (réseau, HTTP, parsing) ou
 * réponse invalide renvoie un tableau vide, jamais d'exception.
 *
 * Mode `basic` : strictement 1 crédit par recherche (budget 1000 crédits).
 *
 * @param query  - La requête exacte à envoyer à Tavily.
 * @param apiKey - La clé d'API Tavily (transmise via le header `Authorization`).
 * @returns Les résultats textuels de la requête, éventuellement vides.
 */
async function rechercherUneFois(
  query: string,
  apiKey: string,
): Promise<SearchResult[]> {
  try {
    const response = await fetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_images: false,
        max_results: 8,
      }),
    });

    // Une réponse HTTP en erreur ne doit jamais faire échouer la recherche.
    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as TavilyResponse;

    // Journalise le nombre de résultats et le contenu du premier résultat.
    const premierResultat = Array.isArray(data.results)
      ? data.results[0]
      : undefined;
    console.log(
      `[Tavily] ${Array.isArray(data.results) ? data.results.length : 0} resultat(s) recu(s) pour « ${query} ».`,
      premierResultat
        ? {
            titre: premierResultat.title,
            url: premierResultat.url,
            longueurTexte:
              typeof premierResultat.content === "string"
                ? premierResultat.content.length
                : 0,
          }
        : null,
    );

    return Array.isArray(data.results)
      ? data.results
          .filter(
            (result): result is { title: string; url: string; content: string } =>
              result !== null &&
              typeof result.title === "string" &&
              typeof result.url === "string" &&
              typeof result.content === "string",
          )
          .map((result) => ({
            title: result.title,
            url: result.url,
            content: result.content,
          }))
      : [];
  } catch {
    // Échec réseau ou parsing : on retourne un tableau vide, jamais d'erreur.
    return [];
  }
}

/**
 * Effectue une recherche web via l'API Tavily selon les deux requêtes de
 * l'Étape 1 du brief technique V1, exécutées en parallèle :
 *  - Requête 1 (Tests pro & specs) : `${produitNettoye} review`.
 *  - Requête 2 (Signal utilisateur brut) : `${produitNettoye} reddit`.
 *
 * La requête reçue est d'abord nettoyée de ses éventuels suffixes redondants
 * (« review », « test », « avis »). Les deux réponses sont fusionnées en
 * éliminant les doublons d'URLs ; si l'une des deux requêtes échoue, l'autre
 * est malgré tout conservée. Les images étant désactivées, le champ `images`
 * est toujours vide.
 *
 * @param query  - Le terme ou la question à rechercher.
 * @param apiKey - La clé d'API Tavily (transmise via le header `Authorization`).
 * @returns Les résultats textuels fusionnés (`results`) et `images` (vide).
 * @example
 * const { results, images } = await searchWeb("casque Sony WH-1000XM5", process.env.TAVILY_API_KEY);
 */
export async function searchWeb(
  query: string,
  apiKey: string,
): Promise<TavilySearchResult> {
  // Nettoie la requête des suffixes redondants éventuels (« review », « test », « avis »).
  const produitNettoye = query.replace(/\s+(review|test|avis)\s*/gi, " ").trim();

  // Requête 1 : tests pro & specs
  const rechercheSpecs = rechercherUneFois(
    `${produitNettoye} review`,
    apiKey,
  ).catch(() => []);

  // Requête 2 : signal utilisateur brut
  const rechercheUtilisateurs = rechercherUneFois(
    `${produitNettoye} reddit`,
    apiKey,
  ).catch(() => []);

  // Exécution en parallèle ; l'échec éventuel d'une requête est neutralisé.
  const [resultatsSpecs, resultatsUtilisateurs] = await Promise.all([
    rechercheSpecs,
    rechercheUtilisateurs,
  ]);

  const fusionnees = fusionnerSansDoublons([
    ...resultatsSpecs,
    ...resultatsUtilisateurs,
  ]);

  return { results: fusionnees, images: [] };
}

// ---------------------------------------------------------------------------
// Compteur de crédits Tavily (endpoint /usage)
// ---------------------------------------------------------------------------

/** Endpoint REST de l'API Tavily pour la consommation de crédits. */
const TAVILY_USAGE_ENDPOINT = "https://api.tavily.com/usage";

/**
 * Durée de validité du cache mémoire du compteur (5 minutes). Tavily limite à
 * 10 requêtes / 10 minutes : le cache évite d'épuiser ce budget en relisant le
 * compteur à chaque investigation.
 */
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

/** Consommation de crédits Tavily pour le mois en cours. */
export interface TavilyUsageInfo {
  usage: number;
  limit: number;
  remaining: number;
}

/** Cache mémoire du dernier comptage réussi, avec sa date d'expiration. */
let usageCache: { data: TavilyUsageInfo; expiresAt: number } | null = null;

/**
 * Convertit une valeur inconnue (nombre ou chaîne numérique) en entier fini,
 * ou `null` si elle n'est pas exploitable.
 *
 * @param value - Valeur brute extraite de la réponse JSON.
 * @returns L'entier correspondant, ou `null`.
 */
function toFiniteInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

/**
 * Interroge le compteur de crédits Tavily (GET `/usage`) et retourne la
 * consommation du mois en cours. Le résultat est mis en cache en mémoire
 * pendant 5 minutes pour respecter le rate limit de l'API (10 req/10 min).
 *
 * Tolérante aux pannes : tout échec (réseau, HTTP, parsing) est capturé
 * silencieusement et renvoie `null`, jamais d'exception.
 *
 * @param apiKey - La clé d'API Tavily (transmise via le header `Authorization`).
 * @returns `{ usage, limit, remaining }`, ou `null` si indisponible.
 */
export async function getTavilyUsage(
  apiKey: string,
): Promise<TavilyUsageInfo | null> {
  const maintenant = Date.now();
  if (usageCache && usageCache.expiresAt > maintenant) {
    return usageCache.data;
  }

  try {
    const response = await fetch(TAVILY_USAGE_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    // Une réponse HTTP en erreur ne doit jamais faire échouer l'appelant.
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      key?: { usage?: unknown; limit?: unknown };
      account?: { plan_usage?: unknown; plan_limit?: unknown };
      usage?: unknown;
      limit?: unknown;
    };

    // Affiche la réponse brute de l'API pour vérifier la structure réelle.
    console.log("[Tavily] Réponse brute usage :", payload);

    // Doc officielle : la consommation est sous key.{usage,limit}, avec un
    // écho account.{plan_usage,plan_limit} et un fallback racine usage/limit.
    const usage =
      payload.key?.usage ?? payload.account?.plan_usage ?? payload.usage ?? 0;
    const limit =
      payload.key?.limit ?? payload.account?.plan_limit ?? payload.limit ?? 1000;

    const usageNumerique = toFiniteInteger(usage);
    const limitNumerique = toFiniteInteger(limit);
    if (usageNumerique === null || limitNumerique === null) {
      return null;
    }

    const data: TavilyUsageInfo = {
      usage: usageNumerique,
      limit: limitNumerique,
      remaining: Math.max(0, limitNumerique - usageNumerique),
    };
    usageCache = { data, expiresAt: Date.now() + USAGE_CACHE_TTL_MS };
    return data;
  } catch {
    // Échec réseau ou parsing : on retourne null, jamais d'erreur.
    return null;
  }
}
