import {
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { classifySourceDomain } from "@/lib/gemini";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Database,
  ExternalLink,
  Flag,
  Loader2,
  MinusCircle,
  Search,
  ShieldCheck,
  Star,
  ThumbsDown,
  ThumbsUp,
  Users,
  XCircle,
  Zap,
} from "lucide-react";
import type {
  ConfidenceLevel,
  Finding,
  InvestigationReport,
  Risk,
  Source,
  VerdictType,
} from "@/types/investigation";
import type { TavilyUsageInfo } from "@/lib/tavily";

/** Réponse de l'API : le rapport complet, enrichi d'un flag de provenance cache. */
type ReportWithMeta = InvestigationReport & { fromCache?: boolean };

/** Icône utilisable dans un composant (prop `className`). */
type IconType = ComponentType<{ className?: string }>;

/**
 * Exemples populaires pré-chargés (déjà en cache côté serveur) proposés en
 * 1 clic sous la barre de recherche. Sans casque audio.
 */
const POPULAR_EXAMPLES = [
  { label: "Dyson V15 Detect", icon: "🧹" },
  { label: "Steam Deck OLED", icon: "🎮" },
  { label: "DJI Mini 4 Pro", icon: "🚁" },
  { label: "Anker 737 Power Bank", icon: "🔋" },
];

// ---------------------------------------------------------------------------
// Mappings d'affichage (classes Tailwind en clair pour que JIT les conserve)
// ---------------------------------------------------------------------------

const VERDICT_LABEL: Record<VerdictType, string> = {
  recommended: "Recommandé",
  caution: "Prudence",
  avoid: "À éviter",
  inconclusive: "Inconcluant",
};

const VERDICT_STYLE: Record<
  VerdictType,
  { badge: string; icon: IconType; iconClassName: string }
> = {
  recommended: {
    badge:
      "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
    icon: CheckCircle2,
    iconClassName: "text-emerald-600 dark:text-emerald-300",
  },
  caution: {
    badge:
      "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
    icon: AlertTriangle,
    iconClassName: "text-amber-600 dark:text-amber-300",
  },
  avoid: {
    badge:
      "border-red-600/30 bg-red-500/10 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300",
    icon: XCircle,
    iconClassName: "text-red-600 dark:text-red-300",
  },
  inconclusive: {
    badge:
      "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:border-slate-400/40 dark:bg-slate-400/10 dark:text-slate-300",
    icon: MinusCircle,
    iconClassName: "text-slate-600 dark:text-slate-300",
  },
};

const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  high: "Confiance élevée",
  medium: "Confiance moyenne",
  low: "Confiance faible",
};

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  high: "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-400/10 dark:text-emerald-300",
  medium:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300",
  low: "border-slate-500/30 bg-slate-500/10 text-slate-700 dark:border-slate-400/40 dark:bg-slate-400/10 dark:text-slate-300",
};

// ---------------------------------------------------------------------------
// Petits helpers d'affichage
// ---------------------------------------------------------------------------

function formaterDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function normaliserDomaine(domaine: string): string {
  return domaine.replace(/^www\./, "").toLowerCase();
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: IconType;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <h2 className="text-lg font-semibold tracking-tight text-foreground">
        {children}
      </h2>
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: VerdictType }) {
  const { badge, icon: Icon, iconClassName } = VERDICT_STYLE[verdict];
  return (
    <Badge className={`gap-1.5 border px-3 py-1 text-sm ${badge}`}>
      <Icon className={`h-3.5 w-3.5 ${iconClassName}`} />
      {VERDICT_LABEL[verdict]}
    </Badge>
  );
}

function ConfidenceBadge({
  confidence,
}: {
  confidence: ConfidenceLevel;
}) {
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 border px-3 py-1 text-sm font-medium ${CONFIDENCE_STYLE[confidence]}`}
    >
      <ShieldCheck className="h-3.5 w-3.5" />
      {CONFIDENCE_LABEL[confidence]}
    </Badge>
  );
}

function RisqueBadge({ risk }: { risk: Risk }) {
  // « Confirmé » si le risque est grave selon le modèle, ou si au moins une
  // source fiable (officielle, test pro, consumer report) l'étaye.
  const confirme =
    risk.severity === "critical" ||
    risk.severity === "high" ||
    (risk.sources ?? []).some((source) =>
      ["official", "review", "consumer_report"].includes(
        classifySourceDomain(source.url),
      ),
    );
  return (
    <Badge
      variant="outline"
      className={
        confirme
          ? "gap-1 border-red-600/30 bg-red-500/10 px-2.5 py-0.5 text-red-700 dark:border-red-400/40 dark:bg-red-400/10 dark:text-red-300"
          : "gap-1 border-amber-600/30 bg-amber-500/10 px-2.5 py-0.5 text-amber-700 dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-300"
      }
    >
      <Flag className="h-3 w-3" />
      {confirme ? "Confirmé" : "Signalé par la communauté"}
    </Badge>
  );
}

function FindingItem({ finding, tone }: { finding: Finding; tone: "good" | "bad" }) {
  const good = tone === "good";
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/25 hover:bg-muted/30">
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
          good
            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
            : "bg-red-500/15 text-red-600 dark:text-red-300"
        }`}
      >
        {good ? <ThumbsUp className="h-3.5 w-3.5" /> : <ThumbsDown className="h-3.5 w-3.5" />}
      </span>
      <div className="min-w-0">
        <p className="font-medium leading-snug text-foreground">{finding.title}</p>
        {finding.description && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {finding.description}
          </p>
        )}
        {finding.sources && finding.sources.length > 0 && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {finding.sources.length} source{finding.sources.length > 1 ? "s" : ""}
          </p>
        )}
      </div>
    </li>
  );
}

function SourceRow({ source }: { source: Source }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3 transition-colors hover:border-primary/25 hover:bg-muted/50">
      <div className="min-w-0 flex-1">
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start justify-between gap-2"
        >
          <p
            className="font-medium leading-snug text-foreground line-clamp-2 transition-colors group-hover:text-primary"
            title={source.title}
          >
            {source.title}
          </p>
          <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
        </a>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="rounded-md bg-background px-1.5 py-0.5 text-xs font-medium text-muted-foreground ring-1 ring-inset ring-border">
            {normaliserDomaine(source.domain)}
          </span>
          {source.rating && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-300">
              <Star className="h-3 w-3 fill-current" />
              {source.rating}
            </span>
          )}
          {source.credibilityNote && (
            <span className="text-xs italic text-muted-foreground">
              {source.credibilityNote}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function SourceGroup({ title, sources }: { title: string; sources: Source[] }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border pb-3 pt-4">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}{" "}
          <span className="ml-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
            {sources.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3">
        {sources.length > 0 ? (
          <ul className="space-y-2">
            {sources.map((source, index) => (
              <SourceRow key={`${source.url}-${index}`} source={source} />
            ))}
          </ul>
        ) : (
          <p className="px-2 py-3 text-sm text-muted-foreground">
            Aucune source dans cette catégorie.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard du rapport
// ---------------------------------------------------------------------------

function ReportDashboard({ report }: { report: ReportWithMeta }) {
  const { product, verdict } = report;

  const sources = report.sources ?? [];
  const domainesDistincts = new Set(
    sources.map((source) => normaliserDomaine(source.domain)),
  ).size;

  // Type effectif : priorité absolue aux règles déterministes sur l'URL (corrige
  // aussi les données historiques en cache). Colonne "Tests pros & médias" =
  // official / review / consumer_report, toutes les autres sources vont à droite.
  const sourcesTestsPro: Source[] = [];
  const sourcesRetours: Source[] = [];
  for (const source of sources) {
    const classified = source.url ? classifySourceDomain(source.url) : "other";
    const effectiveType =
      classified !== "other" ? classified : (source.type ?? "other");

    if (
      effectiveType === "official" ||
      effectiveType === "review" ||
      effectiveType === "consumer_report"
    ) {
      sourcesTestsPro.push(source);
    } else {
      sourcesRetours.push(source);
    }
  }

  const whoItsFor = report.targetAudience?.whoItsFor ?? [];
  const whoItsNotFor = report.targetAudience?.whoItsNotFor ?? [];

  return (
    <section className="space-y-8" aria-label="Résultats de l'investigation">
      {/* 1. Header Produit */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 p-6 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {product.brand && (
              <p className="text-sm font-semibold uppercase tracking-widest text-primary">
                {product.brand}
              </p>
            )}
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {product.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {product.category && (
                <Badge variant="secondary" className="text-xs">
                  {product.category}
                </Badge>
              )}
              {product.kind && (
                <Badge variant="outline" className="text-xs capitalize">
                  {product.kind === "service" ? "Service" : "Produit"}
                </Badge>
              )}
              {product.url && (
                <a
                  href={product.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Fiche officielle
                </a>
              )}
            </div>
          </div>

          {product.images && product.images.length > 0 && (
            <div className="flex shrink-0 flex-wrap gap-2 md:max-w-[9.5rem]">
              {product.images.slice(0, 4).map((image) => (
                <img
                  key={image}
                  src={image}
                  alt=""
                  loading="lazy"
                  className="h-20 w-20 rounded-xl border border-border object-cover sm:h-24 sm:w-24"
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* 2. Verdict & Confiance */}
      <Card>
        <CardContent className="flex flex-col gap-5 p-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <VerdictBadge verdict={verdict.type} />
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Verdict
              </span>
            </div>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-foreground/90">
              {verdict.rationale}
            </p>
          </div>

          <div className="shrink-0 rounded-xl border border-border bg-muted/40 p-4 sm:min-w-[16rem]">
            <div className="flex items-center gap-2">
              <ConfidenceBadge confidence={report.confidence} />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {sources.length} source{sources.length > 1 ? "s" : ""} analysée
              {sources.length > 1 ? "s" : ""} · {domainesDistincts} domaine
              {domainesDistincts > 1 ? "s" : ""} distinct
              {domainesDistincts > 1 ? "s" : ""}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 3. Points forts / Points faibles */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <SectionTitle icon={ThumbsUp}>Points forts</SectionTitle>
          {report.strengths && report.strengths.length > 0 ? (
            <ul className="space-y-2.5">
              {report.strengths.map((finding, index) => (
                <FindingItem key={index} finding={finding} tone="good" />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Aucun point fort documenté.
            </p>
          )}
        </div>

        <div className="space-y-4">
          <SectionTitle icon={ThumbsDown}>Points faibles</SectionTitle>
          {report.documentedProblems && report.documentedProblems.length > 0 ? (
            <ul className="space-y-2.5">
              {report.documentedProblems.map((finding, index) => (
                <FindingItem key={index} finding={finding} tone="bad" />
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
              Aucun point faible documenté.
            </p>
          )}
        </div>
      </div>

      {/* 4. Red flags (masqués si aucun risque) */}
      {report.risks && report.risks.length > 0 && (
        <div className="space-y-4">
          <SectionTitle icon={Flag}>Red flags</SectionTitle>
          <ul className="grid gap-3 md:grid-cols-2">
            {report.risks.map((risk, index) => (
              <li
                key={index}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-destructive/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium leading-snug text-foreground">
                    {risk.title}
                  </p>
                  <RisqueBadge risk={risk} />
                </div>
                {risk.description && (
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {risk.description}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 5. Profils d'acheteurs */}
      <div className="space-y-4">
        <SectionTitle icon={Users}>Profils d'acheteurs</SectionTitle>
        <Card>
          <CardContent className="grid gap-6 p-6 md:grid-cols-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" />
                Pour qui c'est fait
              </h3>
              <ul className="mt-3 space-y-2">
                {whoItsFor.length > 0 ? (
                  whoItsFor.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-foreground/90">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      {item}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">—</li>
                )}
              </ul>
            </div>

            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                <XCircle className="h-4 w-4" />
                Qui devrait éviter
              </h3>
              <ul className="mt-3 space-y-2">
                {whoItsNotFor.length > 0 ? (
                  whoItsNotFor.map((item, index) => (
                    <li key={index} className="flex items-start gap-2 text-sm text-foreground/90">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                      {item}
                    </li>
                  ))
                ) : (
                  <li className="text-sm text-muted-foreground">—</li>
                )}
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 6. Sources vérifiables */}
      <div className="space-y-4">
        <SectionTitle icon={ExternalLink}>Sources vérifiables</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <SourceGroup
            title="Tests pros & médias"
            sources={sourcesTestsPro}
          />
          <SourceGroup
            title="Retours utilisateurs & forums"
            sources={sourcesRetours}
          />
        </div>
      </div>

      {/* 7. Footer : horodatage + provenance */}
      <footer className="flex flex-col items-start justify-between gap-3 border-t border-border pt-5 text-xs text-muted-foreground sm:flex-row sm:items-center">
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          Analyse du {formaterDate(report.investigatedAt)}
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium">
          {report.fromCache ? (
            <>
              <Database className="h-3.5 w-3.5 text-primary" />
              Résultat servi depuis le cache
            </>
          ) : (
            <>
              <Zap className="h-3.5 w-3.5 text-primary" />
              Analyse directe (nouvelle enquête)
            </>
          )}
        </span>
      </footer>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Crédits Tavily
// ---------------------------------------------------------------------------

function TavilyUsageBadge({ usage }: { usage: TavilyUsageInfo }) {
  const { limit, remaining } = usage;
  const dotColor = remaining > 200 ? "bg-emerald-500" : "bg-orange-500";
  return (
    <span
      title="Crédits de recherche Tavily restants ce mois-ci"
      aria-label={`${remaining} sur ${limit} crédits de recherche Tavily restants ce mois-ci`}
      className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground"
    >
      <span aria-hidden="true" className={`h-2 w-2 rounded-full ${dotColor}`} />
      {/* En-tête resserré sur mobile : on y affiche uniquement la fraction. */}
      <span className="sm:hidden">
        {remaining}/{limit}
      </span>
      <span className="hidden sm:inline">
        {remaining} / {limit} crédits
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const Index = () => {
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReportWithMeta | null>(null);
  const [usage, setUsage] = useState<TavilyUsageInfo | null>(null);

  /** Recharge le compteur de crédits Tavily (badge d'en-tête). */
  const refreshUsage = useCallback(async () => {
    try {
      const response = await fetch("/api/tavily-usage");
      if (!response.ok) return;
      setUsage((await response.json()) as TavilyUsageInfo);
    } catch {
      // Indisponibilité réseau : on garde la dernière valeur connue.
    }
  }, []);

  // Charge le compteur au montage.
  useEffect(() => {
    void refreshUsage();
  }, [refreshUsage]);

  /** Lance une investigation pour une requête donnée (barre ou exemple 1 clic). */
  const runInvestigation = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) {
      setError("Veuillez saisir un nom de produit ou une URL.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/investigate?q=${encodeURIComponent(trimmed)}`,
      );
      const data = (await response.json()) as ReportWithMeta & { error?: string };

      if (!response.ok) {
        setError(data.error ?? "Une erreur est survenue pendant l'investigation.");
        return;
      }

      setReport(data);
      // Une investigation réussie a pu consommer des crédits : on réactualise le compteur.
      void refreshUsage();
    } catch {
      setError("Une erreur est survenue pendant l'investigation.");
    } finally {
      setIsLoading(false);
    }
  }, [refreshUsage]);

  const handleInvestigate = async (e: FormEvent) => {
    e.preventDefault();
    await runInvestigation(query);
  };

  /** Exemple en 1 clic : remplit le champ de recherche puis investigue aussitôt. */
  const handlePopularExample = (label: string) => {
    setQuery(label);
    void runInvestigation(label);
  };

  const hasReport = report !== null;

  const searchForm = (
    <form
      onSubmit={handleInvestigate}
      aria-busy={isLoading}
      className={`flex w-full flex-col gap-3 sm:flex-row ${
        hasReport ? "" : "mx-auto mt-10 max-w-xl"
      }`}
    >
      <Input
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Enter a product name or URL"
        className="h-12 rounded-xl border-border bg-card text-base shadow-sm placeholder:text-muted-foreground"
        aria-label="Product name or URL"
        disabled={isLoading}
      />
      <Button
        type="submit"
        size="lg"
        className="h-12 shrink-0 rounded-xl px-6 text-base sm:px-8"
        aria-label="Investigate product"
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <Search className="h-5 w-5" />
        )}
        {isLoading ? "Investigating…" : "Investigate"}
      </Button>
    </form>
  );

  const popularExamples = (
    <div
      className={`mx-auto mt-4 flex w-full max-w-xl flex-wrap items-center gap-2 ${
        hasReport ? "justify-center sm:justify-start" : "justify-center"
      }`}
    >
      <span className="text-xs text-muted-foreground">
        Exemples en 1 clic :
      </span>
      {POPULAR_EXAMPLES.map((example) => (
        <button
          key={example.label}
          type="button"
          onClick={() => handlePopularExample(example.label)}
          disabled={isLoading}
          aria-label={`Investiguer ${example.label}`}
          className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-border/80 bg-background/50 px-3 py-1 text-xs text-foreground transition-all hover:border-accent hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">{example.icon}</span>
          {example.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 px-6 py-5 md:px-10">
        <a href="/" className="flex min-w-0 items-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </span>
          <span className="truncate">Proof Before You Buy</span>
        </a>
        {usage && <TavilyUsageBadge usage={usage} />}
      </header>

      {/* Contenu principal */}
      <main className="flex-1 px-4 pb-16 sm:px-6 md:px-10">
        <div className="mx-auto w-full max-w-5xl">
          {!hasReport ? (
            /* État initial : hero centré */
            <section className="flex flex-col items-center px-2 pt-12 text-center sm:pt-20">
              <span className="mb-6 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-sm font-medium text-primary">
                Honest shopping starts here
              </span>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
                Proof Before You Buy
              </h1>
              <p className="mt-5 max-w-xl text-lg text-muted-foreground">
                Investigate before you spend.
              </p>

              {searchForm}

              {popularExamples}

              {error && (
                <p
                  className="mt-6 text-sm text-destructive"
                  role="alert"
                  aria-live="polite"
                >
                  {error}
                </p>
              )}
            </section>
          ) : (
            /* Mode dashboard : recherche compacte en haut */
            <div className="space-y-8">
              <Card>
                <CardContent className="p-4 sm:p-5">
                  {searchForm}

                  {popularExamples}

                  {error && (
                    <p
                      className="mt-4 text-sm text-destructive"
                      role="alert"
                      aria-live="polite"
                    >
                      {error}
                    </p>
                  )}
                </CardContent>
              </Card>

              <ReportDashboard report={report} />
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="px-6 py-5 text-center text-sm text-muted-foreground md:px-10">
        © {new Date().getFullYear()} Proof Before You Buy
      </footer>
    </div>
  );
};

export default Index;
