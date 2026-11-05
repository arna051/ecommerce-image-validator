#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import {
  createImageValidator,
  defineImagePolicy,
  isImageValidatorError,
} from "../dist/index.js";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  process.stderr.write("Usage: node scripts/real-world-smoke.mjs IMAGE...\n");
  process.exitCode = 2;
} else {
  const resolved = await Promise.all(paths.map((path) => realpath(path)));
  const allowedRoots = [...new Set(resolved.map((path) => dirname(path)))];
  const policy = defineImagePolicy({
    id: "real-world-smoke",
    version: 1,
    rules: [
      {
        id: "known-raster-format",
        kind: "enum",
        measurement: "image.format",
        allowed: ["jpeg", "png", "webp", "avif", "tiff", "gif"],
        outcome: "reject",
        unavailable: "reject",
        code: "FORMAT_UNEXPECTED",
        messageKey: "image.format.unexpected",
      },
      {
        id: "white-border",
        kind: "range",
        measurement: "background.borderNearWhiteRatio",
        minimum: 0.9,
        outcome: "review",
        unavailable: "review",
        code: "BORDER_NOT_WHITE",
        messageKey: "image.background.borderNotWhite",
      },
    ],
  });
  const validator = createImageValidator({
    paths: { enabled: true, allowedRoots },
    limits: {
      maxBytes: 20_000_000,
      maxPixels: 40_000_000,
      maxFrames: 1,
      processingTimeoutMs: 30_000,
      concurrency: 4,
    },
  });

  const summaries = [];
  for (const path of resolved) {
    try {
      const bytes = await readFile(path);
      const [bufferResult, streamResult, pathResult] = await Promise.all([
        validator.validate({ image: { kind: "buffer", data: bytes }, policy }),
        validator.validate({
          image: {
            kind: "stream",
            stream: createReadStream(path),
            declaredBytes: bytes.byteLength,
          },
          policy,
        }),
        validator.validate({ image: { kind: "path", path }, policy }),
      ]);
      /** @param {import("../dist/index.js").ImageValidationResult} result */
      const stableFields = (result) => ({
        decision: result.decision,
        input: result.input,
        policy: result.policy,
        measurements: result.measurements,
        findings: result.findings,
        violations: result.violations,
        executions: result.executions,
      });
      const expected = JSON.stringify(stableFields(bufferResult));
      if (
        JSON.stringify(stableFields(streamResult)) !== expected ||
        JSON.stringify(stableFields(pathResult)) !== expected
      ) {
        throw new Error("Buffer, stream, and guarded-path results diverged.");
      }
      summaries.push({
        path,
        status: "validated",
        decision: bufferResult.decision,
        mediaType: bufferResult.input.detectedMediaType,
        dimensions: `${String(bufferResult.input.width)}x${String(bufferResult.input.height)}`,
        borderNearWhiteRatio:
          bufferResult.measurements["background.borderNearWhiteRatio"]?.value,
        hasAlpha: bufferResult.measurements["image.hasAlpha"]?.value,
        sourceSha256: bufferResult.measurements["hash.sourceSha256"]?.value,
        pixelSha256: bufferResult.measurements["hash.pixelSha256"]?.value,
        violations: bufferResult.violations.map((violation) => violation.code),
      });
    } catch (error) {
      summaries.push({
        path,
        status: "error",
        code: isImageValidatorError(error) ? error.code : "UNEXPECTED_ERROR",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  process.stdout.write(`${JSON.stringify(summaries, null, 2)}\n`);
  if (summaries.some((summary) => summary.status === "error"))
    process.exitCode = 1;
}
