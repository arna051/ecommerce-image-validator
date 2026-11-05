import { createHash } from "node:crypto";
import type {
  AnalyzerInput,
  AnalyzerOutput,
  ImageAnalyzer,
  Measurement,
} from "./contracts.js";
import { ImageValidatorError } from "./errors.js";

const source = { id: "builtin-pixel-analysis", version: "1.0.0" } as const;
const measurement = (
  value: number | string | boolean,
  unit?: string,
): Measurement => (unit ? { value, unit, source } : { value, source });

function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const qualityAnalyzer: ImageAnalyzer = {
  id: "quality",
  version: "1.0.0",
  analyze(input: AnalyzerInput, signal: AbortSignal): AnalyzerOutput {
    const { pixels, width, height, channels } = input;
    let sum = 0;
    let sumSquares = 0;
    let clippedDark = 0;
    let clippedLight = 0;
    let count = 0;
    for (let y = 0; y < height; y += 1) {
      if ((y & 127) === 0 && signal.aborted) {
        throw new ImageValidatorError("ABORTED", "Image analysis was aborted.");
      }
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * channels;
        const light = luminance(
          pixels[index] ?? 0,
          pixels[index + 1] ?? 0,
          pixels[index + 2] ?? 0,
        );
        sum += light;
        sumSquares += light * light;
        if (light <= 5) clippedDark += 1;
        if (light >= 250) clippedLight += 1;
        count += 1;
      }
    }
    const mean = sum / count;
    const deviation = Math.sqrt(Math.max(0, sumSquares / count - mean * mean));
    let edgeEnergy = 0;
    let edgeCount = 0;
    for (let y = 1; y < height - 1; y += 1) {
      if ((y & 127) === 0 && signal.aborted) {
        throw new ImageValidatorError("ABORTED", "Image analysis was aborted.");
      }
      for (let x = 1; x < width - 1; x += 1) {
        const at = (xx: number, yy: number): number => {
          const index = (yy * width + xx) * channels;
          return luminance(
            pixels[index] ?? 0,
            pixels[index + 1] ?? 0,
            pixels[index + 2] ?? 0,
          );
        };
        const laplacian =
          4 * at(x, y) -
          at(x - 1, y) -
          at(x + 1, y) -
          at(x, y - 1) -
          at(x, y + 1);
        edgeEnergy += laplacian * laplacian;
        edgeCount += 1;
      }
    }
    return {
      measurements: {
        "quality.meanLuminance": measurement(Number(mean.toFixed(4)), "0-255"),
        "quality.contrastStdDev": measurement(
          Number(deviation.toFixed(4)),
          "0-255",
        ),
        "quality.darkClippedRatio": measurement(
          Number((clippedDark / count).toFixed(8)),
          "ratio",
        ),
        "quality.lightClippedRatio": measurement(
          Number((clippedLight / count).toFixed(8)),
          "ratio",
        ),
        "quality.laplacianVariance": measurement(
          Number((edgeCount === 0 ? 0 : edgeEnergy / edgeCount).toFixed(4)),
        ),
      },
    };
  },
};

export const backgroundAnalyzer: ImageAnalyzer = {
  id: "border-background",
  version: "1.0.0",
  analyze({ pixels, width, height, channels }: AnalyzerInput): AnalyzerOutput {
    let samples = 0;
    let nearWhite = 0;
    let sum = 0;
    let sumSquares = 0;
    const visit = (x: number, y: number): void => {
      const index = (y * width + x) * channels;
      const r = pixels[index] ?? 0;
      const g = pixels[index + 1] ?? 0;
      const b = pixels[index + 2] ?? 0;
      const light = luminance(r, g, b);
      if (r >= 245 && g >= 245 && b >= 245) nearWhite += 1;
      sum += light;
      sumSquares += light * light;
      samples += 1;
    };
    for (let x = 0; x < width; x += 1) {
      visit(x, 0);
      if (height > 1) visit(x, height - 1);
    }
    for (let y = 1; y < height - 1; y += 1) {
      visit(0, y);
      if (width > 1) visit(width - 1, y);
    }
    const mean = sum / samples;
    const deviation = Math.sqrt(
      Math.max(0, sumSquares / samples - mean * mean),
    );
    return {
      measurements: {
        "background.borderNearWhiteRatio": measurement(
          Number((nearWhite / samples).toFixed(8)),
          "ratio",
        ),
        "background.borderLuminanceStdDev": measurement(
          Number(deviation.toFixed(4)),
          "0-255",
        ),
      },
    };
  },
};

export const hashAnalyzer: ImageAnalyzer = {
  id: "hash",
  version: "1.0.0",
  analyze(input: AnalyzerInput): AnalyzerOutput {
    const pixelHash = createHash("sha256")
      .update(
        `${String(input.width)}x${String(input.height)}x${String(input.channels)}:`,
      )
      .update(input.pixels)
      .digest("hex");
    const sourceHash = createHash("sha256").update(input.source).digest("hex");
    return {
      measurements: {
        "hash.sourceSha256": measurement(sourceHash),
        "hash.pixelSha256": measurement(pixelHash),
      },
    };
  },
};

export const defaultAnalyzers = [
  qualityAnalyzer,
  backgroundAnalyzer,
  hashAnalyzer,
] as const;
