# Security policy

## Reporting

Please report suspected vulnerabilities privately through GitHub's security-advisory feature. Do not include private product images, credentials, signed URLs, or personal metadata in a public issue.

## Threat model and boundaries

Image inputs are untrusted. The validator bounds encoded bytes, decoded pixels, frames/pages, concurrent work, and processing time. Local path access is disabled by default and restricted to configured real-path roots when enabled. Remote URL acquisition is not part of the package.

The validator is not a malware scanner, authorization system, copyright judge, counterfeit detector, or marketplace-acceptance guarantee.

Native decoders can contain vulnerabilities. Keep `sharp`/libvips patched and consider a worker process or container with memory, CPU, filesystem, and network restrictions for internet-facing workloads. A JavaScript timeout cannot forcibly interrupt native code already executing; process isolation is the hard deadline boundary.

Do not log source images, signed URLs, OCR output, EXIF location, product titles, or other private context by default. Optional model providers must implement their own transport security, retention, authentication, and data-location controls.

Only load model weights from trusted configuration with immutable versions and verified hashes. Never enable arbitrary remote model code.
