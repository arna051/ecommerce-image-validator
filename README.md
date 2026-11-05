# ecommerce-image-validator

Policy-driven, explainable validation for ecommerce product images. The core package performs bounded deterministic analysis locally and exposes optional provider contracts for segmentation, OCR, embeddings, and semantic checks.

It does **not** reproduce Digikala's private validation system or guarantee acceptance by any marketplace.

## Install

```bash
npm install ecommerce-image-validator
```

Node.js 22 or newer is required.

## Quick start

```ts
import {
  basicWebsiteImagePolicy,
  createImageValidator,
} from "ecommerce-image-validator";

const validator = createImageValidator();

const result = await validator.validate({
  image: { kind: "buffer", data: imageBuffer },
  context: { role: "main", category: "perfume" },
  policy: basicWebsiteImagePolicy,
});

console.log(result.decision, result.violations);
```

The decision is `accept`, `review`, or `reject`. Measurements are factual analyzer outputs; violations are policy interpretations. Stable codes and `messageKey` values are intended for application localization.

## Custom policies

Policies contain JSON-serializable rules and carry an explicit identity and version:

```ts
import { defineImagePolicy } from "ecommerce-image-validator";

const mainImagePolicy = defineImagePolicy({
  id: "shop-main-image",
  version: 1,
  requiredCapabilities: [],
  rules: [
    {
      id: "square-image",
      kind: "range",
      measurement: "image.aspectRatio",
      minimum: 0.99,
      maximum: 1.01,
      outcome: "reject",
      unavailable: "reject",
      code: "IMAGE_NOT_SQUARE",
      messageKey: "image.aspectRatio.square",
    },
    {
      id: "white-border",
      kind: "range",
      measurement: "background.borderNearWhiteRatio",
      minimum: 0.95,
      outcome: "review",
      unavailable: "review",
      code: "BACKGROUND_NOT_WHITE",
      messageKey: "image.background.white",
    },
  ],
});
```

Numeric marketplace rules must be sourced, dated, calibrated, and versioned. The example thresholds are illustrative.

## Inputs and limits

Buffers, `Uint8Array` values, Node readable streams, and guarded local paths are supported. URL fetching is intentionally excluded; callers should fetch through their own SSRF-safe infrastructure and pass a stream or buffer.

```ts
const validator = createImageValidator({
  limits: {
    maxBytes: 12_000_000,
    maxPixels: 30_000_000,
    maxFrames: 1,
    processingTimeoutMs: 10_000,
    concurrency: 4,
  },
  paths: {
    enabled: true,
    allowedRoots: ["/srv/product-images"],
  },
});
```

Path access is disabled by default. Allowed paths are checked using real paths, root containment, regular-file checks, and an open-file identity check.

## Optional providers

A policy can declare required capabilities. Providers advertise those capabilities and return ordinary measurements/findings. If a required capability is unavailable, validation degrades to `review` rather than silently accepting.

```ts
const provider = {
  descriptor: {
    id: "my-segmentation-service",
    version: "1.2.0",
    capabilities: ["foreground-mask"],
  },
  async health() {
    return { available: true };
  },
  async analyze(input, signal) {
    return { measurements: {} };
  },
};
```

No model weights are bundled. See [MODEL_LICENSING.md](MODEL_LICENSING.md).

## Built-in measurements

- `image.*`: bytes, dimensions, aspect ratio, detected format, frames, alpha, orientation, colour space.
- `quality.*`: luminance, contrast, clipped-pixel ratios, and a Laplacian sharpness proxy.
- `background.*`: border near-white ratio and border luminance variation.
- `hash.*`: source and normalized-pixel SHA-256 hashes.

Quality measurements are signals, not universal truth. Calibrate policies against representative labelled product images.

## Privacy and security

The package does not log or retain source images. It does not fetch URLs or execute model code. Native image decoding should still be treated as hostile-input processing; keep dependencies patched and use process/container isolation for high-risk deployments. See [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci
npm run check
```

To exercise a built package against local real-world images without adding those images to the repository:

```bash
npm run build
npm run test:real-world -- /path/to/product-1.jpg /path/to/product-2.png
```

The smoke runner checks that buffer, stream, and guarded-path inputs produce identical stable evidence and decisions. See [docs/REAL_WORLD_VERIFICATION.md](docs/REAL_WORLD_VERIFICATION.md) for the latest recorded corpus run.

## License

MIT. Model and dataset licences are independent of this package's licence.
