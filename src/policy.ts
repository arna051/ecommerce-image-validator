import { createHash } from "node:crypto";
import { z } from "zod";
import type { Measurement, Violation } from "./contracts.js";
import { ImageValidatorError } from "./errors.js";

const baseRuleSchema = z.object({
  id: z.string().min(1),
  measurement: z.string().min(1),
  code: z.string().min(1),
  outcome: z.enum(["info", "review", "reject"]).default("reject"),
  unavailable: z.enum(["ignore", "review", "reject"]).default("review"),
  messageKey: z.string().min(1),
});

export const imagePolicyRuleSchema = z.discriminatedUnion("kind", [
  baseRuleSchema.extend({
    kind: z.literal("range"),
    minimum: z.number().optional(),
    maximum: z.number().optional(),
  }),
  baseRuleSchema.extend({
    kind: z.literal("enum"),
    allowed: z.array(z.union([z.string(), z.number(), z.boolean()])).min(1),
  }),
  baseRuleSchema.extend({ kind: z.literal("boolean"), expected: z.boolean() }),
]);

export const imagePolicySchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  description: z.string().optional(),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  rules: z.array(imagePolicyRuleSchema),
});

export type ImagePolicyRule = z.infer<typeof imagePolicyRuleSchema>;
export type ImagePolicy = z.infer<typeof imagePolicySchema>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function defineImagePolicy(input: unknown): ImagePolicy {
  const parsed = imagePolicySchema.safeParse(input);
  if (!parsed.success) {
    throw new ImageValidatorError(
      "POLICY_INVALID",
      "The image policy is invalid.",
      {
        cause: parsed.error,
      },
    );
  }
  const ids = new Set<string>();
  for (const rule of parsed.data.rules) {
    if (ids.has(rule.id)) {
      throw new ImageValidatorError(
        "POLICY_INVALID",
        `Duplicate policy rule id: ${rule.id}`,
      );
    }
    ids.add(rule.id);
    if (
      rule.kind === "range" &&
      rule.minimum === undefined &&
      rule.maximum === undefined
    ) {
      throw new ImageValidatorError(
        "POLICY_INVALID",
        `Range rule ${rule.id} has no bounds.`,
      );
    }
  }
  return Object.freeze(parsed.data);
}

export function digestImagePolicy(policy: ImagePolicy): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(policy)))
    .digest("hex");
}

function severity(outcome: ImagePolicyRule["outcome"]): Violation["severity"] {
  return outcome === "reject"
    ? "error"
    : outcome === "review"
      ? "warning"
      : "info";
}

export function evaluatePolicy(
  policy: ImagePolicy,
  measurements: Readonly<Record<string, Measurement>>,
): { decision: "accept" | "review" | "reject"; violations: Violation[] } {
  const violations: Violation[] = [];
  for (const rule of policy.rules) {
    const measurement = measurements[rule.measurement];
    if (!measurement) {
      if (rule.unavailable !== "ignore") {
        violations.push({
          ruleId: rule.id,
          code: `${rule.code}.unavailable`,
          severity: rule.unavailable === "reject" ? "error" : "warning",
          messageKey: `${rule.messageKey}.unavailable`,
        });
      }
      continue;
    }
    const value = measurement.value;
    let passed = false;
    if (rule.kind === "range") {
      passed =
        typeof value === "number" &&
        (rule.minimum === undefined || value >= rule.minimum) &&
        (rule.maximum === undefined || value <= rule.maximum);
    } else if (rule.kind === "enum") {
      passed = rule.allowed.some((allowed) => allowed === value);
    } else {
      passed = value === rule.expected;
    }
    if (!passed) {
      violations.push({
        ruleId: rule.id,
        code: rule.code,
        severity: severity(rule.outcome),
        messageKey: rule.messageKey,
        parameters: { actual: value },
      });
    }
  }
  const decision = violations.some((item) => item.severity === "error")
    ? "reject"
    : violations.some((item) => item.severity === "warning")
      ? "review"
      : "accept";
  return { decision, violations };
}

export const basicWebsiteImagePolicy = defineImagePolicy({
  id: "website-basic",
  version: 1,
  description:
    "Conservative deterministic checks for ordinary ecommerce images.",
  rules: [
    {
      id: "format-supported",
      kind: "enum",
      measurement: "image.format",
      allowed: ["jpeg", "png", "webp", "avif"],
      code: "IMAGE_FORMAT_NOT_ALLOWED",
      messageKey: "image.format.notAllowed",
    },
    {
      id: "width-minimum",
      kind: "range",
      measurement: "image.width",
      minimum: 600,
      code: "IMAGE_WIDTH_TOO_SMALL",
      messageKey: "image.width.tooSmall",
    },
    {
      id: "height-minimum",
      kind: "range",
      measurement: "image.height",
      minimum: 600,
      code: "IMAGE_HEIGHT_TOO_SMALL",
      messageKey: "image.height.tooSmall",
    },
  ],
});
