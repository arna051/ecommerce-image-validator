import { Readable } from "node:stream";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import {
  ImageValidatorError,
  createImageValidator,
  defineImagePolicy,
  type CapabilityProvider,
} from "../src/index.js";

let whiteJpeg: Buffer;
let darkPng: Buffer;

beforeAll(async () => {
  whiteJpeg = await sharp({
    create: { width: 640, height: 640, channels: 3, background: "#ffffff" },
  })
    .jpeg()
    .toBuffer();
  darkPng = await sharp({
    create: { width: 32, height: 24, channels: 4, background: "#101010ff" },
  })
    .png()
    .toBuffer();
});

const policy = defineImagePolicy({
  id: "test",
  version: 1,
  rules: [
    {
      id: "square",
      kind: "range",
      measurement: "image.aspectRatio",
      minimum: 0.99,
      maximum: 1.01,
      code: "NOT_SQUARE",
      messageKey: "square",
    },
    {
      id: "border",
      kind: "range",
      measurement: "background.borderNearWhiteRatio",
      minimum: 0.95,
      code: "BORDER_NOT_WHITE",
      messageKey: "border",
      outcome: "review",
    },
  ],
});

describe("validator", () => {
  it("accepts a conforming buffer and returns explainable measurements", async () => {
    const result = await createImageValidator().validate({
      image: { kind: "buffer", data: whiteJpeg },
      context: { role: "main" },
      policy,
    });
    expect(result.decision).toBe("accept");
    expect(result.valid).toBe(true);
    expect(result.input).toMatchObject({
      detectedMediaType: "image/jpeg",
      width: 640,
      height: 640,
    });
    expect(result.measurements["background.borderNearWhiteRatio"]?.value).toBe(
      1,
    );
    expect(result.measurements["hash.pixelSha256"]?.value).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(result.policy.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reports auto-oriented dimensions and composites transparency on white", async () => {
    const oriented = await sharp({
      create: { width: 20, height: 10, channels: 3, background: "#ffffff" },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const orientedResult = await createImageValidator().validate({
      image: { kind: "buffer", data: oriented },
      policy: defineImagePolicy({ id: "none", version: 1, rules: [] }),
    });
    expect(orientedResult.input).toMatchObject({ width: 10, height: 20 });
    expect(orientedResult.measurements["image.aspectRatio"]?.value).toBe(0.5);

    const transparent = await sharp({
      create: { width: 10, height: 10, channels: 4, background: "#00000000" },
    })
      .png()
      .toBuffer();
    const transparentResult = await createImageValidator().validate({
      image: { kind: "buffer", data: transparent },
      policy: defineImagePolicy({ id: "none", version: 1, rules: [] }),
    });
    expect(transparentResult.measurements["image.hasAlpha"]?.value).toBe(true);
    expect(
      transparentResult.measurements["background.borderNearWhiteRatio"]?.value,
    ).toBe(1);
  });

  it("reads streams and rejects or reviews violated rules", async () => {
    const result = await createImageValidator().validate({
      image: {
        kind: "stream",
        stream: Readable.from([darkPng]),
        declaredBytes: darkPng.length,
      },
      policy,
    });
    expect(result.decision).toBe("reject");
    expect(result.violations.map((item) => item.code)).toEqual([
      "NOT_SQUARE",
      "BORDER_NOT_WHITE",
    ]);
  });

  it("bounds bytes and rejects corrupt or multi-frame images", async () => {
    const small = createImageValidator({ limits: { maxBytes: 10 } });
    await expect(
      small.validate({ image: { kind: "buffer", data: whiteJpeg }, policy }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    await expect(
      createImageValidator().validate({
        image: { kind: "buffer", data: Buffer.from("not an image") },
        policy,
      }),
    ).rejects.toMatchObject({ code: "DECODE_FAILED" });

    await expect(
      createImageValidator({ limits: { maxPixels: 4 } }).validate({
        image: { kind: "buffer", data: darkPng },
        policy,
      }),
    ).rejects.toBeInstanceOf(ImageValidatorError);
  });

  it("fails safely for a deterministic malformed-input corpus", async () => {
    let state = 0x12345678;
    const nextByte = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state & 0xff;
    };
    const validator = createImageValidator();
    for (let length = 1; length <= 64; length += 1) {
      const data = Uint8Array.from({ length }, nextByte);
      await expect(
        validator.validate({ image: { kind: "buffer", data }, policy }),
      ).rejects.toMatchObject({ code: "DECODE_FAILED" });
    }
  });

  it("honors aborted requests", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      createImageValidator().validate({
        image: { kind: "buffer", data: whiteJpeg },
        policy,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("enforces processing deadlines between analyzer operations", async () => {
    const validator = createImageValidator({
      limits: { processingTimeoutMs: 1 },
      analyzers: [
        {
          id: "slow",
          version: "1",
          async analyze() {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {};
          },
        },
      ],
    });
    await expect(
      validator.validate({
        image: { kind: "buffer", data: whiteJpeg },
        policy,
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_TIMEOUT" });
  });

  it("times out providers that ignore abort and releases the concurrency slot", async () => {
    const provider: CapabilityProvider = {
      descriptor: { id: "hung", version: "1", capabilities: ["semantic"] },
      health: () => Promise.resolve({ available: true }),
      analyze: () => new Promise(() => undefined),
    };
    const validator = createImageValidator({
      providers: [provider],
      analyzers: [],
      limits: { processingTimeoutMs: 100, concurrency: 1 },
    });
    const required = defineImagePolicy({
      id: "required",
      version: 1,
      requiredCapabilities: ["semantic"],
      rules: [],
    });
    await expect(
      validator.validate({
        image: { kind: "buffer", data: whiteJpeg },
        policy: required,
      }),
    ).rejects.toMatchObject({ code: "PROCESSING_TIMEOUT" });
    const result = await validator.validate({
      image: { kind: "buffer", data: whiteJpeg },
      policy: defineImagePolicy({ id: "none", version: 1, rules: [] }),
    });
    expect(result.decision).toBe("accept");
  });

  it("runs required providers and degrades missing capabilities to review", async () => {
    const semanticPolicy = defineImagePolicy({
      id: "semantic",
      version: 1,
      requiredCapabilities: ["semantic-similarity"],
      rules: [],
    });
    const missing = await createImageValidator().validate({
      image: { kind: "buffer", data: whiteJpeg },
      policy: semanticPolicy,
    });
    expect(missing.decision).toBe("review");
    expect(missing.violations[0]?.code).toBe("CAPABILITY_UNAVAILABLE");

    const provider: CapabilityProvider = {
      descriptor: {
        id: "fake",
        version: "1",
        capabilities: ["semantic-similarity"],
      },
      health() {
        return Promise.resolve({ available: true });
      },
      analyze() {
        return Promise.resolve({
          findings: [
            {
              code: "MATCH",
              confidence: 0.9,
              source: { id: "fake", version: "1" },
            },
          ],
        });
      },
    };
    const validator = createImageValidator({ providers: [provider] });
    expect(validator.capabilities()).toEqual(["semantic-similarity"]);
    expect(await validator.health()).toEqual({ fake: true });
    const completed = await validator.validate({
      image: { kind: "buffer", data: whiteJpeg },
      policy: semanticPolicy,
    });
    expect(completed.decision).toBe("accept");
    expect(completed.executions[0]?.status).toBe("completed");
    expect(completed.findings[0]?.code).toBe("MATCH");
  });
});
