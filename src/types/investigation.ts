/**
 * Core data model for Proof Before You Buy investigations.
 *
 * The model is modular: each entity is self-contained and references the
 * others only through small, stable shapes (e.g. `Source`), so the schema can
 * be extended or trimmed without rippling through the rest of the system.
 */

// -------------------------- Controlled vocabularies --------------------------

/** Overall conclusion of an investigation. */
export type VerdictType = "recommended" | "caution" | "avoid" | "inconclusive";

/** How strongly the evidence supports a conclusion. */
export type ConfidenceLevel = "high" | "medium" | "low";

/** Importance of a problem or risk. */
export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Strength of the body of evidence behind the report. */
export type EvidenceRating = "strong" | "moderate" | "weak" | "none";

/** Kind of publication a source is. */
export type SourceType =
  | "official"
  | "marketplace"
  | "review"
  | "news"
  | "government"
  | "consumer_report"
  | "forum"
  | "social"
  | "blog"
  | "video"
  | "other";

// ------------------------------- Entities -----------------------------------

/** What the user asked us to investigate. */
export interface InvestigationRequest {
  /** Raw user input: a product name, brand, or listing URL. */
  query: string;
  /** ISO 8601 timestamp of when the investigation was requested. */
  requestedAt: string;
}

/** The product or service an investigation is about. */
export interface ProductIdentity {
  /** Display name of the product or service. */
  name: string;
  /** Canonical ID used to refer to this product across the platform. */
  canonicalProductId: string;
  /** Primary URL where the product is sold or promoted. */
  url?: string;
  /** Brand or manufacturer behind the product. */
  brand?: string;
  /** Category, e.g. "smartphone" or "fitness-app". */
  category?: string;
  /** Whether the item is a physical product or a service. */
  kind?: "product" | "service";
  /** Aliases and alternate names the product is known by. */
  aliases?: string[];
  /** URLs d'images du produit (max 4), issues de la recherche web. */
  images?: string[];
}

/** The conclusion reached by an investigation. */
export interface Verdict {
  type: VerdictType;
  /** Plain-language explanation of why this conclusion was reached. */
  rationale: string;
}

/** A single evidence-backed statement — used for strengths and problems. */
export interface Finding {
  /** Short heading, e.g. "30-day return policy". */
  title: string;
  /** Full factual description of the finding. */
  description: string;
  /** Sources that substantiate this finding. */
  sources: Source[];
  /** Relative weight for ranking findings (higher = more significant). */
  impact?: number;
}

/** A potential harm or drawback the buyer should weigh. */
export interface Risk {
  title: string;
  description: string;
  severity: Severity;
  /** How likely the risk is to materialize, if known. */
  likelihood?: "certain" | "likely" | "possible" | "unlikely" | "rare";
  /** Known way to reduce or avoid the risk, if any. */
  mitigation?: string;
  sources: Source[];
}

/** Two opposing claims that could not be reconciled during investigation. */
export interface Contradiction {
  /** The contested subject, e.g. "stated battery life". */
  topic: string;
  claimA: ContradictionClaim;
  claimB: ContradictionClaim;
  /** Which side the evidence favors, and why, if determinable. */
  resolution?: string;
}

interface ContradictionClaim {
  statement: string;
  sources: Source[];
}

/** Who the product is (and is not) a good fit for. */
export interface TargetAudience {
  /** One-paragraph summary of the intended audience. */
  summary: string;
  /** Groups the product suits well. */
  whoItsFor: string[];
  /** Groups the product does not suit. */
  whoItsNotFor: string[];
  /** Situations where the product is best used. */
  bestUseCases: string[];
}

/** Overall assessment of how trustworthy the evidence behind a report is. */
export interface EvidenceQuality {
  overallRating: EvidenceRating;
  /** Number of independent sources that back the report. */
  sourceCount: number;
  /** Evidence gaps or weak spots that should be noted. */
  gaps?: string[];
  /** Free-form notes on credibility, recency, or bias. */
  notes?: string;
}

/** A single citation used as proof. */
export interface Source {
  url: string;
  title: string;
  domain: string;
  type: SourceType;
  /** Note ou score mentionné par la source (ex: "4.5/5", "89%", "4 étoiles"). */
  rating?: string;
  /** ISO 8601 date the source was published or retrieved. */
  date?: string;
  /** Short justification of this source's credibility. */
  credibilityNote?: string;
}

/** The complete result of an investigation, from request to verdict. */
export interface InvestigationReport {
  /** The product or service under investigation. */
  product: ProductIdentity;
  /** ISO 8601 timestamp of when the investigation was completed. */
  investigatedAt: string;
  verdict: Verdict;
  confidence: ConfidenceLevel;
  /** What the product does well. */
  strengths: Finding[];
  /** Problems that are factually documented, with their sources. */
  documentedProblems: Finding[];
  risks: Risk[];
  contradictions: Contradiction[];
  targetAudience: TargetAudience;
  evidenceQuality: EvidenceQuality;
  sources: Source[];
}