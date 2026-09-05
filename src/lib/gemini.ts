import { searchWeb, type SearchResult } from "@/lib/tavily";
import type {
  ConfidenceLevel,
  InvestigationReport,
  Source,
  SourceType,
} from "@/types/investigation";

/**
 * Pipeline d'investigation en deux étapes :
 * 1. Recherche web via Tavily pour récupérer des données et des sources réelles.
 * 2. Analyse et synthèse structurée par Gemini (gemini-3.5-flash-lite) avec JSON Schema garanti.
 */

/** Modèle Gemini utilisé pour la génération structurée. */
const GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Endpoint REST de l'API Gemini pour la génération de contenu. */
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

/** Domaines officiels de marques → type déterministe `official`. */
export const OFFICIAL_DOMAINS = [
  "dyson.com",
  "apple.com",
  "sony.com",
  "google.com",
  "samsung.com",
  "anker.com",
  "valve.com",
  "steampowered.com",
  "dji.com",
  "roborock.com",
];

/** Domaines de tests pros / médias → type déterministe `review` ou `consumer_report`. */
export const PRO_DOMAINS = [
  "rtings.com",
  "consumerreports.org",
  "techgearlab.com",
  "vacuumwars.com",
  "popularmechanics.com",
  "trustedreviews.com",
  "expertreviews.co.uk",
  "pcmag.com",
  "cnet.com",
  "androidauthority.com",
  "techradar.com",
  "theverge.com",
  "01net.com",
  "lesnumeriques.com",
  "tomsguide.fr",
  "tomsguide.com",
  "whichvac.com",
  "amateurphotographer.com",
  "fstoppers.com",
  "digitalfoundry.net",
  "soundguys.com",
  "wirecutter.com",
  "nytimes.com",
];

/**
 * Classe de manière déterministe une source à partir de son URL uniquement.
 * La priorité est donnée aux listes statiques (marques officielles puis tests
 * pros), avant les règles génériques (forum, video, marketplace). Une URL
 * invalide ou un domaine inconnu renvoie `other`.
 *
 * @param url - URL complète de la source.
 * @returns Le type de source déterministe.
 */
export function classifySourceDomain(url: string): SourceType {
  let domain = "";
  try {
    domain = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "other";
  }

  if (OFFICIAL_DOMAINS.some((d) => domain.endsWith(d))) return "official";
  if (PRO_DOMAINS.some((d) => domain.endsWith(d))) {
    return domain.includes("consumerreports.org") ? "consumer_report" : "review";
  }
  if (domain.includes("reddit.com") || domain.includes("forum")) return "forum";
  if (domain.includes("youtube.com")) return "video";
  if (["amazon.", "fnac.", "bestbuy.", "aliexpress."].some((m) => domain.includes(m))) return "marketplace";

  console.info("[Classification] Domaine non classifié découvert :", domain);
  return "other";
}

/** Schéma JSON Schema passé à generationConfig.responseSchema pour contraindre la réponse de Gemini. */
const INVESTIGATION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    product: {
      type: "OBJECT",
      properties: {
        name: { type: "STRING" },
        canonicalProductId: { type: "STRING" },
        url: { type: "STRING" },
        brand: { type: "STRING" },
        category: { type: "STRING" },
        kind: { type: "STRING", enum: ["product", "service"] },
      },
      required: ["name", "canonicalProductId"],
    },
    verdict: {
      type: "OBJECT",
      properties: {
        type: {
          type: "STRING",
          enum: ["recommended", "caution", "avoid", "inconclusive"],
        },
        rationale: { type: "STRING" },
      },
      required: ["type", "rationale"],
    },
    confidence: {
      type: "STRING",
      enum: ["high", "medium", "low"],
    },
    strengths: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          sources: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                url: { type: "STRING" },
                title: { type: "STRING" },
                domain: { type: "STRING" },
                type: {
                  type: "STRING",
                  enum: [
                    "official",
                    "marketplace",
                    "review",
                    "news",
                    "government",
                    "consumer_report",
                    "forum",
                    "social",
                    "blog",
                    "video",
                    "other",
                  ],
                },
                rating: { type: "STRING" },
              },
              required: ["url", "title", "domain", "type"],
            },
          },
        },
        required: ["title", "description", "sources"],
      },
    },
    documentedProblems: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          sources: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                url: { type: "STRING" },
                title: { type: "STRING" },
                domain: { type: "STRING" },
                type: {
                  type: "STRING",
                  enum: [
                    "official",
                    "marketplace",
                    "review",
                    "news",
                    "government",
                    "consumer_report",
                    "forum",
                    "social",
                    "blog",
                    "video",
                    "other",
                  ],
                },
                rating: { type: "STRING" },
              },
              required: ["url", "title", "domain", "type"],
            },
          },
        },
        required: ["title", "description", "sources"],
      },
    },
    risks: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          description: { type: "STRING" },
          severity: {
            type: "STRING",
            enum: ["critical", "high", "medium", "low", "info"],
          },
          sources: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                url: { type: "STRING" },
                title: { type: "STRING" },
                domain: { type: "STRING" },
                type: {
                  type: "STRING",
                  enum: [
                    "official",
                    "marketplace",
                    "review",
                    "news",
                    "government",
                    "consumer_report",
                    "forum",
                    "social",
                    "blog",
                    "video",
                    "other",
                  ],
                },
                rating: { type: "STRING" },
              },
              required: ["url", "title", "domain", "type"],
            },
          },
        },
        required: ["title", "description", "severity", "sources"],
      },
    },
    contradictions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          topic: { type: "STRING" },
          claimA: {
            type: "OBJECT",
            properties: {
              statement: { type: "STRING" },
              sources: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    url: { type: "STRING" },
                    title: { type: "STRING" },
                    domain: { type: "STRING" },
                    type: { type: "STRING" },
                    rating: { type: "STRING" },
                  },
                  required: ["url", "title", "domain", "type"],
                },
              },
            },
            required: ["statement", "sources"],
          },
          claimB: {
            type: "OBJECT",
            properties: {
              statement: { type: "STRING" },
              sources: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    url: { type: "STRING" },
                    title: { type: "STRING" },
                    domain: { type: "STRING" },
                    type: { type: "STRING" },
                    rating: { type: "STRING" },
                  },
                  required: ["url", "title", "domain", "type"],
                },
              },
            },
            required: ["statement", "sources"],
          },
        },
        required: ["topic", "claimA", "claimB"],
      },
    },
    targetAudience: {
      type: "OBJECT",
      properties: {
        summary: { type: "STRING" },
        whoItsFor: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        whoItsNotFor: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
        bestUseCases: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
      required: ["summary", "whoItsFor", "whoItsNotFor", "bestUseCases"],
    },
    evidenceQuality: {
      type: "OBJECT",
      properties: {
        overallRating: {
          type: "STRING",
          enum: ["strong", "moderate", "weak", "none"],
        },
        sourceCount: { type: "INTEGER" },
        gaps: {
          type: "ARRAY",
          items: { type: "STRING" },
        },
      },
      required: ["overallRating", "sourceCount", "gaps"],
    },
  },
  required: [
    "product",
    "verdict",
    "confidence",
    "strengths",
    "documentedProblems",
    "risks",
    "contradictions",
    "targetAudience",
    "evidenceQuality",
  ],
};

/** Forme brute minimale renvoyée par l'endpoint generateContent de Gemini. */
interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

/**
 * Construit le prompt envoyé à Gemini en intégrant les résultats de recherche web Tavily.
 *
 * @param query - La requête de l'utilisateur (nom du produit ou URL).
 * @param searchResults - Les résultats de recherche fournis par Tavily.
 * @returns Le texte du prompt complet.
 */
function creerPrompt(query: string, searchResults: SearchResult[]): string {
  const resultatsFormates =
    searchResults.length > 0
      ? searchResults
          .map(
            (r, index) =>
              `Source [${index + 1}]:\n- Titre : ${r.title}\n- URL : ${r.url}\n- Extrait : ${r.content}`,
          )
          .join("\n\n")
      : "Aucun résultat de recherche web disponible.";

  return `Tu es un enquêteur indépendant spécialisé dans la vérification des produits et services avant achat.

Enquête sur le produit ou service suivant : « ${query} ».

Voici les informations et preuves issues de la recherche web en direct :

--- DÉBUT DES RÉSULTATS WEB ---
${resultatsFormates}
--- FIN DES RÉSULTATS WEB ---

Consignes impératives :
1. Base ton analyse UNIQUEMENT sur ces informations précises et vérifiables (pas de connaissances générales inventées).
2. Pour chaque point fort, problème ou risque, cite les sources web réelles fournies ci-dessus (en reprenant leur URL, titre et domaine).
3. Rends un verdict impartial, honnête et nuancé pour guider l'acheteur.
4. Pour chaque source, si une note (rating) est explicitement mentionnée dans les extraits (par exemple « 4.5/5 sur Amazon »), recopie-la dans le champ « rating » de cette source ; si aucune note n'est mentionnée, laisse le champ « rating » absent.
5. Dans la liste « risks », étalonne la sévérité de chaque risque ainsi :
   - Sévérité « high » (voire « critical ») pour les défauts matériels avérés, les contraintes physiques vérifiables (par exemple autonomie réelle mesurée, gâchette, prix élevé) ou un consensus multi-sources.
   - Sévérité « medium » ou « low » pour les plaintes isolées d'utilisateurs ou les pannes sporadiques rapportées sur les forums.`;
}

/**
 * Construit un rapport de secours minimal et valide en cas de défaillance.
 *
 * @param query - La demande de recherche initiale.
 * @returns Un rapport d'investigation de secours avec statut inconclusif.
 */
function creerRapportDeSecours(query: string): InvestigationReport {
  return {
    product: {
      name: query,
      canonicalProductId: `generated-${query}`,
    },
    investigatedAt: new Date().toISOString(),
    verdict: {
      type: "inconclusive",
      rationale:
        "Le service d'enquête n'a pas pu produire de rapport. Réessayez plus tard ou reformulez votre demande.",
    },
    confidence: "low",
    strengths: [],
    documentedProblems: [],
    risks: [],
    contradictions: [],
    targetAudience: {
      summary: "Aucune information suffisante pour cibler une audience.",
      whoItsFor: [],
      whoItsNotFor: [],
      bestUseCases: [],
    },
    evidenceQuality: {
      overallRating: "none",
      sourceCount: 0,
      gaps: ["Enquête indisponible : la source de données n'a pas répondu."],
    },
    sources: [],
  };
}

/** Analyse structurée renvoyée par Gemini, sans l'horodatage ni la liste globale de sources. */
type RapportGeminiAnalyse = Omit<
  InvestigationReport,
  "investigatedAt" | "sources"
>;

/** Valeurs autorisées pour `Source.type` (l'énumération libre des contradictions doit être filtrée). */
const TYPES_SOURCE_VALIDES: ReadonlySet<string> = new Set<SourceType>([
  "official",
  "marketplace",
  "review",
  "news",
  "government",
  "consumer_report",
  "forum",
  "social",
  "blog",
  "video",
  "other",
]);

/**
 * Extrait le nom de domaine d'une URL (avec repli sur l'URL brute).
 *
 * @param url - URL complète de la source.
 * @returns Le nom de domaine, ou l'URL brute si elle est invalide.
 */
function extraireDomaine(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Normalise une URL en clé de correspondance : minuscules, sans protocole,
 * sans « www. » ni slash final. Permet d'associer une citation Gemini à un
 * résultat Tavily même si leurs formes diffèrent (http/https, www, slash).
 *
 * @param url - URL à normaliser.
 * @returns La clé normalisée.
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
 * Déduit automatiquement le type d'une source à partir de son domaine et de
 * son URL. Règles appliquées dans l'ordre :
 * 0. Classification déterministe par URL (`classifySourceDomain`) — listes
 *    statiques officielles / tests pros d'abord, puis forum / video /
 *    marketplace par domaine.
 * 1. Domaine contenant « reddit.com » ou « quora.com », ou commençant par
 *    « forum. » → `forum` (domaines hors listes, ex. quora, cdiscount, ebay).
 * 2. Domaine contenant « youtube.com » → `video`.
 * 3. Domaine contenant « amazon. », « fnac. », « aliexpress. », « bestbuy. »,
 *    « cdiscount. » ou « ebay. » → `marketplace`.
 * 4. URL ou titre contenant « review », « test » ou « avis » → `review`.
 * 5. Sinon → `other`.
 *
 * @param domaine - Nom de domaine de la source.
 * @param url     - URL complète de la source.
 * @param titre   - Titre de la source.
 * @returns Le type de source déduit.
 */
function deduireTypeSource(
  domaine: string,
  url: string,
  titre: string,
): SourceType {
  // 0. Priorité absolue à la classification déterministe par URL.
  const typeClassifie = classifySourceDomain(url);
  if (typeClassifie !== "other") {
    return typeClassifie;
  }

  const hote = domaine.toLowerCase();

  if (
    hote.includes("reddit.com") ||
    hote.includes("quora.com") ||
    hote.startsWith("forum.")
  ) {
    return "forum";
  }

  if (hote.includes("youtube.com")) {
    return "video";
  }

  if (
    [
      "amazon.",
      "fnac.",
      "aliexpress.",
      "bestbuy.",
      "cdiscount.",
      "ebay.",
    ].some((marche) => hote.includes(marche))
  ) {
    return "marketplace";
  }

  const texte = `${url} ${titre}`.toLowerCase();
  if (
    texte.includes("review") ||
    texte.includes("test") ||
    texte.includes("avis")
  ) {
    return "review";
  }

  return "other";
}

/**
 * Retient le type qualifié par Gemini quand il est exploitable (valeur
 * autorisée et différente de « other »), sinon retombe sur la déduction
 * automatique par domaine, URL et titre.
 *
 * @param typeGemini - Type renvoyé par Gemini pour la source.
 * @param domaine    - Domaine de la source.
 * @param url        - URL de la source.
 * @param titre      - Titre de la source.
 * @returns Le type de source effectif.
 */
function typeEffectif(
  typeGemini: string | undefined,
  domaine: string,
  url: string,
  titre: string,
): SourceType {
  if (
    typeGemini &&
    typeGemini !== "other" &&
    TYPES_SOURCE_VALIDES.has(typeGemini)
  ) {
    return typeGemini as SourceType;
  }
  return deduireTypeSource(domaine, url, titre);
}

/**
 * Répertorie toutes les sources citées par Gemini dans les sections
 * `strengths`, `documentedProblems`, `risks` et `contradictions`
 * (qui contiennent déjà le type qualifié et le rating éventuel).
 *
 * @param rapportGemini - Analyse structurée renvoyée par Gemini.
 * @returns La liste brute des sources citées, sections dans l'ordre.
 */
function collecterSourcesCitees(rapportGemini: RapportGeminiAnalyse): Source[] {
  const sources: Source[] = [];

  for (const constat of [
    ...rapportGemini.strengths,
    ...rapportGemini.documentedProblems,
  ]) {
    sources.push(...constat.sources);
  }

  for (const risque of rapportGemini.risks) {
    sources.push(...risque.sources);
  }

  for (const contradiction of rapportGemini.contradictions) {
    sources.push(...contradiction.claimA.sources);
    sources.push(...contradiction.claimB.sources);
  }

  return sources;
}

/**
 * Associe chaque source citée par Gemini (par URL normalisée) aux
 * enrichissements qu'elle apporte : type qualifié, rating et credibilityNote
 * éventuels. En cas de doublon, la variante portant un rating est privilégiée.
 *
 * @param rapportGemini - Analyse structurée renvoyée par Gemini.
 * @returns Une correspondance URL normalisée → source citée (enrichissements).
 */
function collecterEnrichissementsGemini(
  rapportGemini: RapportGeminiAnalyse,
): Map<string, Source> {
  const enrichissements = new Map<string, Source>();

  for (const citee of collecterSourcesCitees(rapportGemini)) {
    const cle = normaliserUrl(citee.url);
    if (!cle) continue;

    const existante = enrichissements.get(cle);
    if (!existante || (!existante.rating && citee.rating)) {
      enrichissements.set(cle, citee);
    }
  }

  return enrichissements;
}

/**
 * Harmonise et enrichit la liste globale des sources d'un rapport.
 *
 * Pour chaque résultat Tavily, associe les enrichissements trouvés par Gemini
 * (type, rating, credibilityNote s'ils existent) lorsque la source y est
 * citée ; si Gemini ne l'a pas citée, applique la déduction automatique de
 * type par domaine. Les sources citées par Gemini mais absentes des résultats
 * Tavily sont ajoutées en fin de liste, afin que `rapport.sources` référence
 * bien tous les liens avec leur domaine propre, leur vrai `type` (et non
 * « other » par défaut) et leur `rating` s'il existe.
 *
 * @param tavilyResults - Résultats bruts retournés par Tavily.
 * @param rapportGemini - Analyse structurée renvoyée par Gemini.
 * @returns Tableau final de `Source`, ordonné par résultats Tavily puis citations complémentaires.
 */
function harmoniserSources(
  tavilyResults: SearchResult[],
  rapportGemini: RapportGeminiAnalyse,
): Source[] {
  const enrichissements = collecterEnrichissementsGemini(rapportGemini);
  const dejaVues = new Set<string>();
  const sources: Source[] = [];

  // 1. Résultats Tavily, enrichis par Gemini ou déduits automatiquement.
  for (const resultat of tavilyResults) {
    if (!resultat.url) continue;

    const domaine = extraireDomaine(resultat.url);
    const cle = normaliserUrl(resultat.url);
    if (dejaVues.has(cle)) continue;
    dejaVues.add(cle);

    const enrichie = enrichissements.get(cle);

    sources.push({
      url: resultat.url,
      title: resultat.title || resultat.url,
      domain: domaine,
      type: typeEffectif(
        enrichie?.type,
        domaine,
        resultat.url,
        resultat.title,
      ),
      rating: enrichie?.rating,
      credibilityNote: enrichie?.credibilityNote,
    });
  }

  // 2. Sources citées par Gemini mais absentes des résultats Tavily.
  for (const citee of collecterSourcesCitees(rapportGemini)) {
    const cle = normaliserUrl(citee.url);
    if (!cle || dejaVues.has(cle)) continue;
    dejaVues.add(cle);

    const domaine = extraireDomaine(citee.url);

    sources.push({
      url: citee.url,
      title: citee.title || citee.url,
      domain: citee.domain || domaine,
      type: typeEffectif(citee.type, domaine, citee.url, citee.title),
      rating: citee.rating,
      credibilityNote: citee.credibilityNote,
    });
  }

  return sources;
}

/**
 * Calcule de manière déterministe et objective le niveau de confiance d'un
 * rapport à partir du nombre de domaines distincts parmi ses sources.
 *
 * Critères stricts du brief technique :
 *  - 3 domaines distincts ou plus → `high` ;
 *  - exactement 2 domaines distincts → `medium` ;
 *  - 0 ou 1 domaine distinct → `low`.
 *
 * Les domaines sont nettoyés (préfixe « www. » retiré) et mis en minuscules
 * avant décompte, pour ne pas compter deux fois un même site.
 *
 * @param sources - Sources finales du rapport (déjà harmonisées).
 * @returns Le niveau de confiance calculé.
 */
function calculerNiveauConfiance(sources: Source[]): ConfidenceLevel {
  const domainesDistincts = new Set(
    sources.map((source) =>
      source.domain.replace(/^www\./, "").toLowerCase(),
    ),
  );

  if (domainesDistincts.size >= 3) return "high";
  if (domainesDistincts.size === 2) return "medium";
  return "low";
}

/**
 * Enquête sur un produit ou service en deux étapes :
 * 1. Recherche web via Tavily.
 * 2. Analyse et rapport structuré via Gemini avec JSON Schema forcé.
 *
 * @param query         - Produit ou service à enquêter.
 * @param geminiApiKey  - Clé d'API Gemini.
 * @param tavilyApiKey  - Clé d'API Tavily.
 * @returns Le rapport d'investigation final complet.
 */
export async function investigateProduct(
  query: string,
  geminiApiKey: string,
  tavilyApiKey: string,
): Promise<InvestigationReport> {
  try {
    // 1. Recherche web via Tavily (résultats textuels + images produit)
    const { results, images } = await searchWeb(
      `${query} review avis`,
      tavilyApiKey,
    );

    // 2. Construction du prompt enrichi
    const prompt = creerPrompt(query, results);

    // 3. Appel à Gemini avec generationConfig garantissant la sortie JSON structurée.
    // Réessai automatique (2 tentatives au total) sur les statuts de surcharge 500/503.
    const url = `${GEMINI_ENDPOINT}?key=${geminiApiKey}`;
    const options: RequestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: INVESTIGATION_RESPONSE_SCHEMA,
        },
      }),
    };

    let response = await fetch(url, options);

    // Une surcharge temporaire (500/503) relance automatiquement une seconde fois.
    if (response.status === 500 || response.status === 503) {
      console.warn(
        `[Gemini] Statut ${response.status} (surcharge temporaire). Nouvelle tentative dans 2 secondes...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));
      response = await fetch(url, options);
    }

    if (!response.ok) {
      // Journalise le statut et le corps de la réponse pour faciliter le diagnostic.
      console.error(
        "[Gemini] Réponse HTTP en erreur :",
        response.status,
        await response.text().catch(() => ""),
      );
      throw new Error(`L'API Gemini a répondu HTTP ${response.status}`);
    }

    const data = (await response.json()) as GeminiGenerateContentResponse;
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      throw new Error("La réponse Gemini ne contient aucun texte généré.");
    }

    // 4. Parsing direct garanti valide grâce au responseSchema
    const parsed = JSON.parse(rawText) as Omit<
      InvestigationReport,
      "investigatedAt" | "sources"
    >;

    // 5. Rapport final avec horodatage et sources réelles enrichies par Gemini
    const finalReport: InvestigationReport = {
      ...parsed,
      investigatedAt: new Date().toISOString(),
      sources: harmoniserSources(results, parsed),
    };

    // Confiance et sourceCount recalculés de façon déterministe sur les sources finales.
    finalReport.confidence = calculerNiveauConfiance(finalReport.sources);
    finalReport.evidenceQuality.sourceCount = finalReport.sources.length;

    // Attache jusqu'à 4 images produit trouvées par Tavily à la fiche produit.
    if (images && images.length > 0) {
      finalReport.product.images = images.slice(0, 4);
    }

    return finalReport;
  } catch (error) {
    // 6. En cas d'échec total, journalise la cause puis retourne un rapport de secours valide
    console.error("[Gemini] Échec lors de la génération du rapport :", error);
    return creerRapportDeSecours(query);
  }
}