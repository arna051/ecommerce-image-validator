import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { createImageValidator, defineImagePolicy } from "../src/index.js";

const temporary: string[] = [];
const policy = defineImagePolicy({ id: "none", version: 1, rules: [] });

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("input security", () => {
  it("disables paths by default and validates allowed roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "eiv-root-"));
    temporary.push(root);
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const path = join(root, "image.png");
    await writeFile(path, image);
    await expect(
      createImageValidator().validate({
        image: { kind: "path", path },
        policy,
      }),
    ).rejects.toMatchObject({ code: "PATH_ACCESS_DISABLED" });
    const result = await createImageValidator({
      paths: { enabled: true, allowedRoots: [root] },
    }).validate({
      image: { kind: "path", path },
      policy,
    });
    expect(result.input.detectedMediaType).toBe("image/png");

    const dotted = join(root, "..image.png");
    await writeFile(dotted, image);
    const dottedResult = await createImageValidator({
      paths: { enabled: true, allowedRoots: [root] },
    }).validate({ image: { kind: "path", path: dotted }, policy });
    expect(dottedResult.input.detectedMediaType).toBe("image/png");
  });

  it("rejects paths and symlinks escaping an allowed root", async () => {
    const root = await mkdtemp(join(tmpdir(), "eiv-root-"));
    const outside = await mkdtemp(join(tmpdir(), "eiv-outside-"));
    temporary.push(root, outside);
    const image = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    const target = join(outside, "secret.png");
    await writeFile(target, image);
    await symlink(target, join(root, "escape.png"));
    const validator = createImageValidator({
      paths: { enabled: true, allowedRoots: [root] },
    });
    await expect(
      validator.validate({ image: { kind: "path", path: target }, policy }),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
    await expect(
      validator.validate({
        image: { kind: "path", path: join(root, "escape.png") },
        policy,
      }),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  it("rejects directories, empty input, oversized streams, and missing roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "eiv-root-"));
    temporary.push(root);
    await mkdir(join(root, "directory"));
    const validator = createImageValidator({
      paths: { enabled: true, allowedRoots: [root] },
    });
    await expect(
      validator.validate({
        image: { kind: "path", path: join(root, "directory") },
        policy,
      }),
    ).rejects.toMatchObject({ code: "PATH_NOT_REGULAR_FILE" });
    await expect(
      validator.validate({
        image: { kind: "buffer", data: new Uint8Array() },
        policy,
      }),
    ).rejects.toMatchObject({ code: "INPUT_EMPTY" });
    await expect(
      createImageValidator({ limits: { maxBytes: 3 } }).validate({
        image: { kind: "stream", stream: Readable.from([Buffer.from("1234")]) },
        policy,
      }),
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE" });
    expect(() => createImageValidator({ paths: { enabled: true } })).toThrow(
      /allowed root/,
    );
  });
});
