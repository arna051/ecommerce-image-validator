export const imageValidatorErrorCodes = [
  "ABORTED",
  "DECODE_FAILED",
  "INPUT_EMPTY",
  "INPUT_TOO_LARGE",
  "INVALID_CONFIGURATION",
  "PATH_ACCESS_DISABLED",
  "PATH_NOT_ALLOWED",
  "PATH_NOT_REGULAR_FILE",
  "POLICY_INVALID",
  "PROCESSING_TIMEOUT",
  "UNSUPPORTED_IMAGE",
] as const;

export type ImageValidatorErrorCode = (typeof imageValidatorErrorCodes)[number];

export class ImageValidatorError extends Error {
  readonly code: ImageValidatorErrorCode;
  override readonly cause?: unknown;

  constructor(
    code: ImageValidatorErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message);
    this.name = "ImageValidatorError";
    this.code = code;
    if (options && "cause" in options) this.cause = options.cause;
  }
}

export function isImageValidatorError(
  error: unknown,
): error is ImageValidatorError {
  return error instanceof ImageValidatorError;
}
