# Policy versioning

A result records the policy ID, integer version, and canonical SHA-256 digest. Consumers should store all three with the decision when historical reproducibility matters.

Change the policy version whenever a rule, threshold, severity, unavailable behavior, or required capability changes. Typographical documentation changes do not require a new version.

Marketplace presets must cite the source and observation date in repository documentation. Unverified numeric rules must not be presented as official requirements. Category exceptions should be expressed as separate composed policy definitions in application code until the package adds a formally versioned composition format.

Stable violation codes and message keys are not translated. Applications map `messageKey` and parameters to localized guidance.
