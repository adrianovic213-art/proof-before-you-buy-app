import { createDb } from "@/db/client";
import { investigateProduct } from "@/lib/gemini";
import { getTavilyUsage } from "@/lib/tavily";
import { cacheReport, getCachedReport } from "@/lib/investigationCache";
import { TursoCacheStore } from "@/lib/tursoCacheStore";

interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  GEMINI_API_KEY: string;
  TAVILY_API_KEY: string;
}

/** Serialise une valeur quelconque en réponse JSON. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Route API – compteur de crédits Tavily (dédiée, avant le handler /api générique).
    if (url.pathname === "/api/tavily-usage") {
      const usageInfo = await getTavilyUsage(env.TAVILY_API_KEY);
      // Fallback généreux si le compteur est momentanément indisponible.
      return jsonResponse(
        200,
        usageInfo ?? { usage: 0, limit: 1000, remaining: 1000 },
      );
    }

    // Route API – enquête avec cache Turso.
    if (url.pathname.startsWith("/api/")) {
      try {
        // 1. Paramètre "q" requis.
        const q = url.searchParams.get("q");
        if (!q || q.trim().length === 0) {
          return jsonResponse(400, { error: "Le paramètre q est requis" });
        }

        // 2. Cache Turso.
        const db = createDb(env);
        const store = new TursoCacheStore(db);

        // Création idempotente de la table (ne doit jamais faire planter la requête).
        await store.init().catch((err) => console.warn("[Worker] Échec init cache :", err));

        // 3. Rapport déjà en cache ?
        const cachedReport = await getCachedReport(store, q);
        if (cachedReport) {
          return jsonResponse(200, { ...cachedReport, fromCache: true });
        }

        // 4. Pas de cache – vraie enquête Gemini, puis sauvegarde.
        const report = await investigateProduct(q, env.GEMINI_API_KEY, env.TAVILY_API_KEY);

        // Ne jamais mettre en cache un rapport d'échec ou de secours.
        if (report.sources && report.sources.length > 0) {
          await cacheReport(store, q, report);
        }

        return jsonResponse(200, { ...report, fromCache: false });
      } catch (error) {
        // Le Worker ne doit jamais planter silencieusement.
        const message =
          error instanceof Error ? error.message : String(error);
        return jsonResponse(500, { error: message });
      }
    }

    // Tout le reste est délégué aux assets statiques (site React).
    return env.ASSETS.fetch(request);
  },
};