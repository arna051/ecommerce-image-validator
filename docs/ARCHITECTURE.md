# Architecture decision record

## ADR-001: deterministic Node core with pluggable inference

**Status:** accepted

The package performs bounded deterministic checks in Node.js and places probabilistic inference behind capability-provider interfaces. Python, GPU infrastructure, network services, and model weights are not required for core validation.

This keeps basic deployment small and commercially auditable while allowing ONNX, sidecar, or remote providers to evolve without leaking their runtime types through the public API.

The processing flow is:

1. Acquire a bounded buffer from bytes, a stream, or an opt-in guarded path.
2. Probe metadata and reject unsupported dimensions/frames.
3. Auto-orient and normalize decoded pixels to 8-bit sRGB on white.
4. Run ordered deterministic analyzers.
5. Run only providers required by the selected policy.
6. Evaluate versioned serializable policy rules.
7. Return measurements, findings, executions, violations, and an `accept`, `review`, or `reject` decision.

Measurements describe evidence; policies interpret evidence. Missing required probabilistic capabilities produce `review`, not a silent acceptance.

## Consequences

- Native decoding remains a hostile-input boundary and may require process/container isolation.
- JavaScript deadlines release orchestration slots when asynchronous providers ignore cancellation, but cannot forcibly preempt synchronous JavaScript or native code already executing.
- No URL input exists in core, avoiding an implicit SSRF-sensitive fetcher.
- Policies, npm releases, and provider/model versions evolve independently.
- Debug artifacts and image transformations are outside the initial core.
