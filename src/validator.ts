import { performance } from "node:perf_hooks";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { defaultAnalyzers } from "./analyzers.js";
import type {
  AnalyzerOutput,
  CapabilityProvider,
  Finding,
  ImageAnalyzer,
  ImageInput,
  ImageValidationResult,
  Measurement,
  ProviderExecution,
  ValidationContext,
} from "./contracts.js";
import { ImageValidatorError } from "./errors.js";
import { acquireInput } from "./input.js";
import {
  defineImagePolicy,
  digestImagePolicy,
  evaluatePolicy,
  type ImagePolicy,
} from "./policy.js";
import { Semaphore } from "./semaphore.js";

export interface ValidatorLimits {
  maxBytes: number;
  maxPixels: number;
  maxFrames: number;
  processingTimeoutMs: number;
  concurrency: number;
}

export interface PathInputOptions {
  enabled: boolean;
  allowedRoots: readonly string[];
}

export interface ImageValidatorOptions {
  limits?: Partial<ValidatorLimits>;
  paths?: Partial<PathInputOptions>;
  analyzers?: readonly ImageAnalyzer[];
  providers?: readonly CapabilityProvider[];
}

export interface ValidateImageRequest {
  image: ImageInput;
  context?: ValidationContext;
  policy: ImagePolicy;
  signal?: AbortSignal;
}

export interface ImageValidator {
  validate(request: ValidateImageRequest): Promise<ImageValidationResult>;
  capabilities(): readonly string[];
  health(signal?: AbortSignal): Promise<Readonly<Record<string, boolean>>>;
}

const defaultLimits: ValidatorLimits = {
  maxBytes: 12_000_000,
  maxPixels: 30_000_000,
  maxFrames: 1,
  processingTimeoutMs: 10_000,
  concurrency: 4,
};

const metadataSource = { id: "sharp-metadata", version: "1.0.0" } as const;
const measurement = (
  value: number | string | boolean,
  unit?: string,
): Measurement =>
  unit
    ? { value, unit, source: metadataSource }
    : { value, source: metadataSource };

function validateLimits(limits: ValidatorLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new ImageValidatorError(
        "INVALID_CONFIGURATION",
        `${key} must be a positive integer.`,
      );
    }
  }
}

function mergeOutput(
  output: AnalyzerOutput,
  measurements: Record<string, Measurement>,
  findings: Finding[],
): void {
  for (const [key, value] of Object.entries(output.measurements ?? {})) {
    if (key in measurements) {
      throw new ImageValidatorError(
        "INVALID_CONFIGURATION",
        `Duplicate measurement key: ${key}`,
      );
    }
    measurements[key] = value;
  }
  findings.push(...(output.findings ?? []));
}

function timeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    timeoutMs,
  );
  timer.unref();
  return { signal: controller.signal, dispose: () => clearTimeout(timer) };
}

function assertNotAborted(signal: AbortSignal, timedOut: boolean): void {
  if (timedOut) {
    throw new ImageValidatorError(
      "PROCESSING_TIMEOUT",
      "Image validation exceeded its processing deadline.",
    );
  }
  if (signal.aborted) {
    throw new ImageValidatorError("ABORTED", "Image validation was aborted.");
  }
}

async function awaitWithSignal<T>(
  work: Promise<T>,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<T> {
  assertNotAborted(signal, timedOut());
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = (): void => {
      try {
        assertNotAborted(signal, timedOut());
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("Image validation was aborted."),
        );
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}

export function createImageValidator(
  options: ImageValidatorOptions = {},
): ImageValidator {
  const limits = { ...defaultLimits, ...options.limits };
  validateLimits(limits);
  const paths: PathInputOptions = {
    enabled: options.paths?.enabled ?? false,
    allowedRoots: options.paths?.allowedRoots ?? [],
  };
  if (paths.enabled && paths.allowedRoots.length === 0) {
    throw new ImageValidatorError(
      "INVALID_CONFIGURATION",
      "Path inputs require at least one allowed root.",
    );
  }
  const analyzers = options.analyzers ?? defaultAnalyzers;
  const providers = options.providers ?? [];
  const semaphore = new Semaphore(limits.concurrency);

  return {
    capabilities(): readonly string[] {
      return [
        ...new Set(
          providers.flatMap((provider) => provider.descriptor.capabilities),
        ),
      ].sort();
    },

    async health(
      signal?: AbortSignal,
    ): Promise<Readonly<Record<string, boolean>>> {
      return Object.fromEntries(
        await Promise.all(
          providers.map(async (provider) => {
            try {
              return [
                provider.descriptor.id,
                (await provider.health(signal)).available,
              ] as const;
            } catch {
              return [provider.descriptor.id, false] as const;
            }
          }),
        ),
      );
    },

    async validate(
      request: ValidateImageRequest,
    ): Promise<ImageValidationResult> {
      const policy = defineImagePolicy(request.policy);
      const release = await semaphore.acquire(request.signal);
      const timeout = timeoutSignal(limits.processingTimeoutMs);
      const signal = request.signal
        ? AbortSignal.any([request.signal, timeout.signal])
        : timeout.signal;
      const started = performance.now();
      const deadlineAt = started + limits.processingTimeoutMs;
      const timedOut = (): boolean =>
        timeout.signal.aborted || performance.now() >= deadlineAt;
      try {
        assertNotAborted(signal, timedOut());
        const acquisitionStarted = performance.now();
        let source: Buffer;
        try {
          source = await acquireInput(
            request.image,
            {
              maxBytes: limits.maxBytes,
              allowPaths: paths.enabled,
              allowedPathRoots: paths.allowedRoots,
            },
            signal,
          );
        } catch (error) {
          assertNotAborted(signal, timedOut());
          throw error;
        }
        const acquiredAt = performance.now();

        let metadata: Metadata;
        let decoded: { data: Buffer; info: OutputInfo };
        try {
          const image = sharp(source, {
            failOn: "warning",
            limitInputPixels: limits.maxPixels,
            sequentialRead: true,
            pages: limits.maxFrames + 1,
          });
          metadata = await image.metadata();
          const frames = metadata.pages ?? 1;
          if (frames > limits.maxFrames) {
            throw new ImageValidatorError(
              "UNSUPPORTED_IMAGE",
              "The image contains too many frames or pages.",
            );
          }
          if (!metadata.width || !metadata.height) {
            throw new ImageValidatorError(
              "UNSUPPORTED_IMAGE",
              "The image metadata is incomplete.",
            );
          }
          const orientedWidth = metadata.autoOrient.width;
          const orientedHeight = metadata.autoOrient.height;
          if (orientedWidth * orientedHeight > limits.maxPixels) {
            throw new ImageValidatorError(
              "UNSUPPORTED_IMAGE",
              "The image exceeds the decoded pixel limit.",
            );
          }
          decoded = await sharp(source, {
            failOn: "warning",
            limitInputPixels: limits.maxPixels,
            sequentialRead: true,
          })
            .rotate()
            .flatten({ background: "#ffffff" })
            .toColourspace("srgb")
            .raw({ depth: "uchar" })
            .toBuffer({ resolveWithObject: true });
        } catch (error) {
          if (error instanceof ImageValidatorError) throw error;
          throw new ImageValidatorError(
            "DECODE_FAILED",
            "The image could not be decoded safely.",
            {
              cause: error,
            },
          );
        }
        assertNotAborted(signal, timedOut());
        const decodedAt = performance.now();
        const orientedWidth = metadata.autoOrient.width;
        const orientedHeight = metadata.autoOrient.height;
        const measurements: Record<string, Measurement> = {
          "image.bytes": measurement(source.byteLength, "bytes"),
          "image.width": measurement(orientedWidth, "pixels"),
          "image.height": measurement(orientedHeight, "pixels"),
          "image.aspectRatio": measurement(
            Number((orientedWidth / orientedHeight).toFixed(8)),
            "ratio",
          ),
          "image.format": measurement(metadata.format),
          "image.frames": measurement(metadata.pages ?? 1),
          "image.hasAlpha": measurement(metadata.hasAlpha),
          "image.orientation": measurement(metadata.orientation ?? 1),
          "image.colourSpace": measurement(metadata.space),
        };
        const findings: Finding[] = [];
        const analyzerInput = {
          source,
          pixels: decoded.data,
          width: decoded.info.width,
          height: decoded.info.height,
          channels: decoded.info.channels,
          context: request.context ?? {},
        };
        for (const analyzer of analyzers) {
          assertNotAborted(signal, timedOut());
          mergeOutput(
            await awaitWithSignal(
              Promise.resolve(analyzer.analyze(analyzerInput, signal)),
              signal,
              timedOut,
            ),
            measurements,
            findings,
          );
          assertNotAborted(signal, timedOut());
        }

        const executions: ProviderExecution[] = [];
        const required = new Set(policy.requiredCapabilities);
        const provided = new Set<string>();
        for (const provider of providers) {
          const relevant = provider.descriptor.capabilities.some((capability) =>
            required.has(capability),
          );
          if (!relevant) {
            executions.push({
              id: provider.descriptor.id,
              version: provider.descriptor.version,
              status: "skipped",
              durationMs: 0,
            });
            continue;
          }
          const providerStarted = performance.now();
          try {
            const health = await awaitWithSignal(
              provider.health(signal),
              signal,
              timedOut,
            );
            if (!health.available) {
              executions.push({
                id: provider.descriptor.id,
                version: provider.descriptor.version,
                status: "unavailable",
                durationMs: Number(
                  (performance.now() - providerStarted).toFixed(3),
                ),
              });
              continue;
            }
            mergeOutput(
              await awaitWithSignal(
                provider.analyze(analyzerInput, signal),
                signal,
                timedOut,
              ),
              measurements,
              findings,
            );
            provider.descriptor.capabilities.forEach((capability) =>
              provided.add(capability),
            );
            executions.push({
              id: provider.descriptor.id,
              version: provider.descriptor.version,
              status: "completed",
              durationMs: Number(
                (performance.now() - providerStarted).toFixed(3),
              ),
            });
          } catch (error) {
            assertNotAborted(signal, timedOut());
            if (error instanceof ImageValidatorError) throw error;
            executions.push({
              id: provider.descriptor.id,
              version: provider.descriptor.version,
              status: "failed",
              errorCode: "PROVIDER_FAILED",
              durationMs: Number(
                (performance.now() - providerStarted).toFixed(3),
              ),
            });
          }
        }
        const missingCapabilities = [...required].filter(
          (capability) => !provided.has(capability),
        );
        const evaluated = evaluatePolicy(policy, measurements);
        const violations = [...evaluated.violations];
        for (const capability of missingCapabilities) {
          violations.push({
            ruleId: `capability.${capability}`,
            code: "CAPABILITY_UNAVAILABLE",
            severity: "warning",
            messageKey: "capability.unavailable",
            parameters: { capability },
          });
        }
        const decision = violations.some(
          (violation) => violation.severity === "error",
        )
          ? "reject"
          : violations.some((violation) => violation.severity === "warning")
            ? "review"
            : "accept";
        const finished = performance.now();
        return {
          decision,
          valid: decision === "accept",
          policy: {
            id: policy.id,
            version: policy.version,
            digest: digestImagePolicy(policy),
          },
          input: {
            detectedMediaType: `image/${metadata.format}`,
            bytes: source.byteLength,
            width: orientedWidth,
            height: orientedHeight,
          },
          measurements,
          findings,
          violations,
          executions,
          timings: {
            acquisitionMs: Number((acquiredAt - acquisitionStarted).toFixed(3)),
            decodeMs: Number((decodedAt - acquiredAt).toFixed(3)),
            totalMs: Number((finished - started).toFixed(3)),
          },
        };
      } finally {
        timeout.dispose();
        release();
      }
    },
  };
}
