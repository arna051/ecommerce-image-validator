# Evaluation plan

Evaluation is a release gate for any accuracy claim or probabilistic rule. Unit tests prove software behavior, not marketplace accuracy.

## Dataset

Maintain a private, versioned manifest of legally usable images across perfume, vape products, clothing, underwear, shoes, beauty products, reflective packaging, transparent objects, and white products. Include main, secondary, and lifestyle images plus accepted, rejected, and ambiguous examples.

Each rule needs positive, negative, and deliberately difficult examples: crops, edge contact, white-on-white products, glass, fur, shadows, models/mannequins, natural package text, Persian and Latin overlays, subtle watermarks, and multiple subjects.

Record provenance, consent/licence, category, role, and rule-level labels. Subjective labels require two reviewers and adjudication. Group exact and perceptual duplicates before train/validation/test splitting to prevent leakage.

Private images, marketplace responses, and derived artifacts must not enter the public repository or npm tarball.

## Metrics

Report precision, recall, F1, false-accept rate, false-reject rate, coverage, and review/abstention rate per rule and category. Calibrate confidence and review bands; do not optimize a single aggregate score.

Operational reports include CPU/GPU p50, p95, and p99 latency, throughput, peak memory, and cold start. Deterministic analyzers use numeric regression tolerances; providers use mask/box snapshot comparisons where appropriate.

Marketplace comparisons may be collected only when authorized and are observational signals, not perfect ground truth.

## Admission gate for a provider

Before a provider can affect a default policy it needs:

1. A completed artefact and licence manifest.
2. Reproducible preprocessing and pinned hashes.
3. Category-specific test results on a held-out dataset.
4. Business-approved false-accept and false-reject targets.
5. Calibrated review boundaries.
6. Latency, memory, cancellation, failure, and degradation tests.
7. A rollback path independent of the npm release.

Production disagreements feed a private relabelling queue. Threshold changes create a new policy version; model changes create a new provider/model version.
