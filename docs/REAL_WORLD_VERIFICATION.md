# Real-world verification

## 2026-11-06 verification run

The package was exercised locally against public ecommerce images and the upstream libvips regression corpus. Third-party images were downloaded to `/tmp` and were not committed or included in the npm tarball.

### Ecommerce scenarios

| Scenario                                         | Source SHA-256                                                     | Observed result                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| White sneaker, 1000×1000 progressive JPEG        | `f7db5a0b60e18f822a9bfada872760641c9144ae62b67d511bec629c7ceacfd3` | `accept`; JPEG correctly detected; white-border ratio 1                 |
| Transparent black shoe, 1441×960 indexed PNG     | `54d5e80e3fccfd88ec9fa77f290f1b332d7174fe9a8f3a1fe2a4b67f7c049bad` | `accept`; alpha reported; transparency composited on white for analysis |
| Perfume lifestyle photograph, 1920×1280 JPEG     | `4bf3a5913fdc0b07ed7aef890c89db4ec5d1bd820a097891d5492ec9ecf51b86` | `review`; non-white border correctly produced `BORDER_NOT_WHITE`        |
| Brown shoe URL named `.jpg` but serving RGBA PNG | `5368771dbbfdd76594187b562897193e0699aa707085239fcbd00abbdc03c75c` | `accept`; detected from pixels as PNG rather than trusting the name     |

The source URLs used for this run were:

- `https://ubonoutdoor.com/cdn/shop/files/BX101W-White-_-01_1000x1000.jpg?v=1737377455`
- `https://freepngimg.com/thumb/shoes/26165-1-black-shoe.png`
- `https://puls-img.chanel.com/1666769719188-15954182248961922parf1922n22djpgmaxlglgjpg_1280x1920.jpg`
- `https://www.klever-schuhe.de/media/e8/7b/8c/1689347312/0162220024-01.jpg`

For every successful image, buffer, Node stream, and guarded local-path validation produced identical input metadata, policy identity, measurements, findings, violations, and provider executions. Timings were intentionally excluded from equality because they are observational.

### Decoder and hostile-input corpus

The libvips test corpus was pinned at commit `12c9899a42ab37970f89626999a9856eea3ffad1`.

Verified successful cases included TIFF, JPEG, PNG, indexed PNG, 1/2/4-bit grayscale TIFF, WebP, AVIF, transparent RGBA, all eight EXIF orientations, 16-bit APNG when multiple frames were explicitly allowed, and a generated CMYK JPEG.

Verified safe failures included:

| Fixture               | SHA-256                                                            | Expected error                                   |
| --------------------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| `truncated.jpg`       | `a62eceaf456650cd121817b741e57f95fa191a3e3b6ad6e437e1506b0189cc87` | `DECODE_FAILED`                                  |
| `truncated.gif`       | `b985ae249e426f583eeccc3cfe5da326d9375b7555b68ebbc1e8dd191565fc77` | `DECODE_FAILED`                                  |
| `cogs.gif` (5 frames) | `d7f2f79d6e995018b1782b453e888642ca5e341f7528b9eb2174f3d62ed78e5f` | `UNSUPPORTED_IMAGE` with default one-frame limit |
| `cogs-apng.png`       | `728c47dd0f1901e050308852d18800f3a42dd658f04ea2eadf98b24cac7164eb` | `UNSUPPORTED_IMAGE` with default one-frame limit |
| `17000x17000.avif`    | `98fc16f4ee1c4980073cd398d74a4b2bff931cff32c3606e4bcdcd187b1f1e7a` | bounded decode failure at the pixel limit        |

The real corpus exposed a bug in the original metadata probe: passing `pages: maxFrames + 1` to Sharp requested nonexistent pages rather than limiting metadata inspection, causing valid single-page TIFF and AVIF images to fail. The option was removed, APNG/WebP container frame detection was added, and regression tests now cover valid TIFF/AVIF plus GIF/APNG limits.

### Concurrency and packaging

- 60 concurrent validations of a 1000×1000 product JPEG completed through a four-slot validator in 2.35 seconds on the test machine.
- All 60 returned `accept` and one identical normalized pixel hash.
- Observed RSS after the run was approximately 309 MB; this is a development-machine observation, not a production capacity guarantee.
- The full test suite, strict type checking, lint, formatting, dual ESM/CJS build, declaration generation, `publint`, clean-consumer imports, and dependency audit passed after the fixes.

### Reproduction

```bash
npm ci
npm run check
npm run build
npm run test:real-world -- /path/to/fixture-a.jpg /path/to/fixture-b.png
```

This verification demonstrates runtime behavior and failure boundaries. It does not establish marketplace accuracy; that requires the labelled category-specific evaluation described in [EVALUATION.md](EVALUATION.md).
