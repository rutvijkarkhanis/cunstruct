// DATA CLASSIFICATION — a lightweight sensitivity model.
//
// Its only job is to let a future, explicitly-authorised AI path know what data
// may leave Cunstruct. It does NOT send anything anywhere and integrates no
// provider. Project drawings/documents are CONFIDENTIAL by default and must not
// be sent to any external provider unless a project has explicitly enabled AI
// processing.

export type DataClassification = "PUBLIC" | "CONFIDENTIAL" | "HIGHLY_CONFIDENTIAL";

/**
 * The kinds of data Cunstruct handles, mapped to a default classification.
 * Reference/catalogue data is PUBLIC (already authenticated-readable app-wide);
 * anything tied to a specific project is CONFIDENTIAL; credentials/PII are
 * HIGHLY_CONFIDENTIAL and must never be sent to a provider at all.
 */
export type DataKind =
  | "reference_catalog"     // DSR items, stages, product catalogue, scope taxonomy
  | "project_metadata"      // project name/type/area — confidential business data
  | "project_document"      // architectural drawings & uploads
  | "document_content"      // parsed drawing content / eval JSON
  | "boq"                   // bills of quantities and lines
  | "audit_finding"         // review findings
  | "user_pii"              // names, emails, phone numbers
  | "credential";           // API keys, tokens, service-role keys, signed URLs

const CLASSIFICATION: Record<DataKind, DataClassification> = {
  reference_catalog: "PUBLIC",
  project_metadata: "CONFIDENTIAL",
  project_document: "CONFIDENTIAL",
  document_content: "CONFIDENTIAL",
  boq: "CONFIDENTIAL",
  audit_finding: "CONFIDENTIAL",
  user_pii: "HIGHLY_CONFIDENTIAL",
  credential: "HIGHLY_CONFIDENTIAL",
};

export function classify(kind: DataKind): DataClassification {
  return CLASSIFICATION[kind];
}

/** True only for data that may ever be shown publicly / sent without a project AI opt-in. */
export function isPublic(kind: DataKind): boolean {
  return classify(kind) === "PUBLIC";
}

export interface SendabilityContext {
  kind: DataKind;
  /** projects.ai_processing_enabled for the owning project. */
  aiProcessingEnabled: boolean;
}

/**
 * Whether a piece of data may be sent to an external AI provider *right now*.
 * The rule is deliberately strict:
 *   - HIGHLY_CONFIDENTIAL (credentials / PII) → NEVER.
 *   - CONFIDENTIAL (project data/documents)   → only when the owning project has
 *     explicitly enabled AI processing.
 *   - PUBLIC (reference catalogue)            → always.
 * There is no AI path today, so nothing is actually sent — this guards the future
 * one.
 */
export function canSendToProvider(ctx: SendabilityContext): boolean {
  const level = classify(ctx.kind);
  if (level === "HIGHLY_CONFIDENTIAL") return false;
  if (level === "PUBLIC") return true;
  return ctx.aiProcessingEnabled === true;
}

/** Throw unless the data may be sent to a provider. Use at the (future) boundary. */
export function assertSendableToProvider(ctx: SendabilityContext): void {
  if (!canSendToProvider(ctx)) {
    const level = classify(ctx.kind);
    throw new Error(
      level === "HIGHLY_CONFIDENTIAL"
        ? `Refusing to send ${ctx.kind}: ${level} data is never sent to an external provider.`
        : `Refusing to send ${ctx.kind}: AI processing is not enabled for this project.`,
    );
  }
}
