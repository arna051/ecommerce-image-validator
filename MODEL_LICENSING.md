# Model and runtime licensing

The npm package contains no model weights. Its MIT licence does not grant rights to third-party models, datasets, runtimes, or services.

Before enabling any model provider, record and review:

- Exact code and weight artefact identities.
- Code licence and weight licence separately.
- Commercial-use and redistribution permissions.
- Training-data terms and known provenance limitations.
- Immutable source revision and cryptographic digest.
- Required runtime/native dependencies and their licences.
- Evaluation results for the intended product categories.

## Candidate status

| Candidate                    | Status                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Sharp/libvips                | Core deterministic runtime; dependency licence and security updates remain part of release review.                       |
| ONNX Runtime                 | Optional provider runtime; test the exact model operators and target platform.                                           |
| PaddleOCR                    | Evaluation candidate; audit exact model weights and benchmark Persian/Latin ecommerce content.                           |
| BiRefNet / U²-Net            | Evaluation candidates only; verify each weight artefact, training data, and redistribution terms.                        |
| SigLIP 2 / DINOv2            | Experimental embedding candidates; admit only exact audited checkpoints after evaluation.                                |
| BRIA RMBG 2.0 public weights | Excluded from default commercial use without an appropriate commercial agreement.                                        |
| Ultralytics software/models  | Excluded from the MIT core unless licensing obligations are deliberately accepted or a commercial agreement is obtained. |

Licence review is an engineering gate, not legal advice. Recheck upstream terms at the time an integration is proposed.
