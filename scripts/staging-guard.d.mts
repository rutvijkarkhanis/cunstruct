// Types for scripts/staging-guard.mjs (imported by vite.config.ts and tests).
export interface StagingTarget { projectRef: string; supabaseUrl: string; publishableKey: string; dbUrl: string }
export interface ProductionInfo { refs: string[]; publishableKey: string | null }
export interface StagingNeed { app?: boolean; db?: boolean }
export const STAGING_ENV_FILE: string;
export function parseEnv(text: string): Record<string, string>;
export function refFromSupabaseUrl(url: string): string | null;
export function refsFromDbUrl(dbUrl: string): string[];
export function readProduction(root: string): ProductionInfo;
export function checkStagingTarget(target: Partial<StagingTarget>, production: Partial<ProductionInfo>, need?: StagingNeed): string[];
export function readStagingTarget(root: string, env?: Record<string, string | undefined>): StagingTarget;
export const PREVIEW_PRODUCTION_OPT_OUT: string;
export function buildUsesStaging(mode: string, env?: Record<string, string | undefined>): boolean;
export function assertStaging(root: string, need: StagingNeed, env?: Record<string, string | undefined>): { ref: string; target: StagingTarget };
