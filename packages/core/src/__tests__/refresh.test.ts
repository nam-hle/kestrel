import { afterEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeProject(): { dir: string; tsConfigPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "kestrel-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true }, include: ["*.ts"] }),
  );
  writeFileSync(join(dir, "a.ts"), "export const value = 1;\n");
  return { dir, tsConfigPath: join(dir, "tsconfig.json") };
}

describe("refreshIfStale", () => {
  test("picks up an out-of-band edit before answering", () => {
    const { dir, tsConfigPath } = makeProject();
    const engine = new Engine({ tsConfigPath });

    const before = engine.resolveSymbol("a.ts:value");
    expect(before.kind).toBe("symbol");

    // Edit the file on disk outside the engine, adding a new declaration.
    writeFileSync(join(dir, "a.ts"), "export const value = 1;\nexport const added = 2;\n");

    expect(engine.resolveSymbol("a.ts:added").kind).toBe("not-found");

    engine.refreshIfStale();

    expect(engine.resolveSymbol("a.ts:added").kind).toBe("symbol");
  });
});
