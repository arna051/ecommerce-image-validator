import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ImageInput } from "./contracts.js";
import { ImageValidatorError } from "./errors.js";

export interface InputLimits {
  maxBytes: number;
  allowPaths: boolean;
  allowedPathRoots: readonly string[];
}

function checkSize(size: number, maxBytes: number): void {
  if (size === 0)
    throw new ImageValidatorError("INPUT_EMPTY", "The image input is empty.");
  if (size > maxBytes) {
    throw new ImageValidatorError(
      "INPUT_TOO_LARGE",
      `Image exceeds the ${String(maxBytes)} byte limit.`,
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new ImageValidatorError("ABORTED", "Image validation was aborted.");
}

async function readStream(
  stream: Extract<ImageInput, { kind: "stream" }>["stream"],
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  const abort = (): void => {
    stream.destroy(
      new ImageValidatorError("ABORTED", "Image validation was aborted."),
    );
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for await (const chunk of stream) {
      throwIfAborted(signal);
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk as Uint8Array);
      total += buffer.byteLength;
      if (total > maxBytes) {
        stream.destroy();
        throw new ImageValidatorError(
          "INPUT_TOO_LARGE",
          `Image exceeds the ${String(maxBytes)} byte limit.`,
        );
      }
      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ImageValidatorError) throw error;
    if (signal.aborted)
      throw new ImageValidatorError("ABORTED", "Image validation was aborted.");
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
  }
  checkSize(total, maxBytes);
  return Buffer.concat(chunks, total);
}

function isContained(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return (
    child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child))
  );
}

async function readGuardedPath(
  path: string,
  limits: InputLimits,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!limits.allowPaths) {
    throw new ImageValidatorError(
      "PATH_ACCESS_DISABLED",
      "Local path inputs are disabled.",
    );
  }
  if (limits.allowedPathRoots.length === 0) {
    throw new ImageValidatorError(
      "INVALID_CONFIGURATION",
      "At least one allowed path root is required.",
    );
  }
  let candidate: string;
  const roots: string[] = [];
  try {
    candidate = await realpath(resolve(path));
    for (const root of limits.allowedPathRoots)
      roots.push(await realpath(resolve(root)));
  } catch (error) {
    throw new ImageValidatorError(
      "PATH_NOT_ALLOWED",
      "The local image path is unavailable.",
      { cause: error },
    );
  }
  if (!roots.some((root) => isContained(root, candidate))) {
    throw new ImageValidatorError(
      "PATH_NOT_ALLOWED",
      "The local image path is outside the allowed roots.",
    );
  }
  throwIfAborted(signal);
  let handle;
  try {
    handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throw new ImageValidatorError(
      "PATH_NOT_ALLOWED",
      "The local image path could not be opened safely.",
      { cause: error },
    );
  }
  try {
    const opened = await handle.stat();
    if (!opened.isFile()) {
      throw new ImageValidatorError(
        "PATH_NOT_REGULAR_FILE",
        "The local image path is not a regular file.",
      );
    }
    checkSize(opened.size, limits.maxBytes);
    const verifiedPath = await realpath(candidate);
    if (!roots.some((root) => isContained(root, verifiedPath))) {
      throw new ImageValidatorError(
        "PATH_NOT_ALLOWED",
        "The local image path changed outside the allowed roots.",
      );
    }
    const verifyHandle = await open(
      verifiedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const verifiedInfo = await verifyHandle.stat();
      if (verifiedInfo.dev !== opened.dev || verifiedInfo.ino !== opened.ino) {
        throw new ImageValidatorError(
          "PATH_NOT_ALLOWED",
          "The local image path changed during access.",
        );
      }
    } finally {
      await verifyHandle.close();
    }
    const bounded = Buffer.allocUnsafe(limits.maxBytes + 1);
    let total = 0;
    while (total <= limits.maxBytes) {
      throwIfAborted(signal);
      const { bytesRead } = await handle.read(
        bounded,
        total,
        bounded.length - total,
        null,
      );
      if (bytesRead === 0) break;
      total += bytesRead;
    }
    checkSize(total, limits.maxBytes);
    return bounded.subarray(0, total);
  } finally {
    await handle.close();
  }
}

export async function acquireInput(
  input: ImageInput,
  limits: InputLimits,
  signal: AbortSignal,
): Promise<Buffer> {
  throwIfAborted(signal);
  if (input.kind === "buffer") {
    checkSize(input.data.byteLength, limits.maxBytes);
    return Buffer.from(
      input.data.buffer,
      input.data.byteOffset,
      input.data.byteLength,
    );
  }
  if (input.kind === "stream") {
    if (input.declaredBytes !== undefined)
      checkSize(input.declaredBytes, limits.maxBytes);
    return readStream(input.stream, limits.maxBytes, signal);
  }
  const result = await readGuardedPath(input.path, limits, signal);
  throwIfAborted(signal);
  return result;
}
