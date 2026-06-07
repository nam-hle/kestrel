/** Read a 1-based inclusive line range from a file's text. Engine-independent. */
import { readFileSync } from "node:fs";

import type { RegionResult } from "./types.js";

export function readRegionFrom(absPath: string, file: string, startLine: number, endLine: number): RegionResult {
	if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
		throw new Error(`invalid line range: ${startLine}-${endLine} (expected 1-based, start <= end)`);
	}

	const lines = readFileSync(absPath, "utf8").split("\n");

	if (startLine > lines.length) {
		throw new Error(`line range out of bounds: ${startLine}-${endLine} (file has ${lines.length} lines)`);
	}

	const end = Math.min(endLine, lines.length);

	return { file, startLine, endLine: end, source: lines.slice(startLine - 1, end).join("\n") };
}
