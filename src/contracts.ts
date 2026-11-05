import type { Readable } from "node:stream";

export type ImageInput =
  | { kind: "buffer"; data: Uint8Array }
  | { kind: "stream"; stream: Readable; declaredBytes?: number }
  | { kind: "path"; path: string };

export type ImageRole = "main" | "secondary" | "lifestyle" | (string & {});

export interface ValidationContext {
  role?: ImageRole;
  category?: string;
  title?: string;
  brand?: string;
  attributes?: Readonly<Record<string, string | number | boolean>>;
}

export type MeasurementValue = number | string | boolean;

export interface Measurement {
  value: MeasurementValue;
  unit?: string;
  source: { id: string; version: string };
}

export interface Finding {
  code: string;
  confidence?: number;
  evidence?: Readonly<Record<string, MeasurementValue>>;
  source: { id: string; version: string };
}

export interface Violation {
  ruleId: string;
  code: string;
  severity: "info" | "warning" | "error";
  messageKey: string;
  parameters?: Readonly<Record<string, MeasurementValue>>;
}

export interface ProviderExecution {
  id: string;
  version: string;
  status: "completed" | "skipped" | "unavailable" | "failed";
  durationMs: number;
  errorCode?: string;
}

export interface DebugArtifactReference {
  kind: "mask" | "box" | "heatmap" | (string & {});
  mediaType: string;
  reference: string;
}

export interface ImageValidationResult {
  decision: "accept" | "review" | "reject";
  valid: boolean;
  policy: { id: string; version: number; digest: string };
  input: {
    detectedMediaType: string;
    bytes: number;
    width: number;
    height: number;
  };
  measurements: Readonly<Record<string, Measurement>>;
  findings: readonly Finding[];
  violations: readonly Violation[];
  executions: readonly ProviderExecution[];
  timings: Readonly<Record<string, number>>;
  artifacts?: readonly DebugArtifactReference[];
}

export interface AnalyzerInput {
  source: Uint8Array;
  pixels: Uint8Array;
  width: number;
  height: number;
  channels: number;
  context: ValidationContext;
}

export interface AnalyzerOutput {
  measurements?: Readonly<Record<string, Measurement>>;
  findings?: readonly Finding[];
}

export interface ImageAnalyzer {
  readonly id: string;
  readonly version: string;
  analyze(
    input: AnalyzerInput,
    signal: AbortSignal,
  ): AnalyzerOutput | Promise<AnalyzerOutput>;
}

export interface ProviderDescriptor {
  id: string;
  version: string;
  capabilities: readonly string[];
  model?: { id: string; version: string; digest?: string };
}

export interface ProviderHealth {
  available: boolean;
  message?: string;
}

export interface CapabilityProvider {
  readonly descriptor: ProviderDescriptor;
  health(signal?: AbortSignal): Promise<ProviderHealth>;
  analyze(input: AnalyzerInput, signal: AbortSignal): Promise<AnalyzerOutput>;
}
