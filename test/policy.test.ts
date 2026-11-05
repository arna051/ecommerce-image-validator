import { describe, expect, it } from "vitest";
import {
  ImageValidatorError,
  defineImagePolicy,
  digestImagePolicy,
  evaluatePolicy,
  type Measurement,
} from "../src/index.js";

const source = { id: "test", version: "1" };
const measured = (value: number | string | boolean): Measurement => ({
  value,
  source,
});

describe("image policies", () => {
  it("validates, hashes, and evaluates a policy deterministically", () => {
    const first = defineImagePolicy({
      version: 1,
      id: "main",
      rules: [
        {
          code: "TOO_SMALL",
          messageKey: "image.small",
          measurement: "image.width",
          id: "width",
          kind: "range",
          minimum: 600,
          outcome: "reject",
          unavailable: "review",
        },
      ],
    });
    const second = defineImagePolicy({
      id: "main",
      rules: first.rules,
      version: 1,
    });
    expect(digestImagePolicy(first)).toBe(digestImagePolicy(second));
    expect(
      evaluatePolicy(first, { "image.width": measured(599) }),
    ).toMatchObject({
      decision: "reject",
      violations: [{ code: "TOO_SMALL", severity: "error" }],
    });
    expect(evaluatePolicy(first, { "image.width": measured(600) })).toEqual({
      decision: "accept",
      violations: [],
    });
    expect(evaluatePolicy(first, {})).toMatchObject({ decision: "review" });
  });

  it("rejects duplicate rule ids and boundless ranges", () => {
    const rule = {
      id: "same",
      kind: "boolean",
      measurement: "x",
      expected: true,
      code: "X",
      messageKey: "x",
    } as const;
    expect(() =>
      defineImagePolicy({ id: "bad", version: 1, rules: [rule, rule] }),
    ).toThrow(ImageValidatorError);
    expect(() =>
      defineImagePolicy({
        id: "bad",
        version: 1,
        rules: [
          {
            id: "x",
            kind: "range",
            measurement: "x",
            code: "X",
            messageKey: "x",
          },
        ],
      }),
    ).toThrow(/no bounds/);
  });

  it("supports enum and boolean rules plus informational findings", () => {
    const policy = defineImagePolicy({
      id: "mixed",
      version: 1,
      rules: [
        {
          id: "format",
          kind: "enum",
          measurement: "format",
          allowed: ["jpeg"],
          code: "FORMAT",
          messageKey: "format",
          outcome: "info",
        },
        {
          id: "alpha",
          kind: "boolean",
          measurement: "alpha",
          expected: false,
          code: "ALPHA",
          messageKey: "alpha",
        },
      ],
    });
    const result = evaluatePolicy(policy, {
      format: measured("png"),
      alpha: measured(false),
    });
    expect(result.decision).toBe("accept");
    expect(result.violations[0]?.severity).toBe("info");
  });
});
