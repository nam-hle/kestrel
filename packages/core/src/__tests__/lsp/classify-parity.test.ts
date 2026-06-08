import { test, expect, describe } from "vitest";

import { classifyAt } from "../../lsp/syntactic.js";
import { CLASSIFY_CORPUS } from "../fixtures/classify-corpus.js";

/** LSP position (0-based line/char) of the nth standalone occurrence of `name`. */
function occurrenceAt(code: string, name: string, occurrence: number): { line: number; character: number } {
	const re = new RegExp(`\\b${name}\\b`, "g");
	let index = -1;
	let seen = 0;

	for (let m = re.exec(code); m !== null; m = re.exec(code)) {
		if (seen++ === occurrence) {
			index = m.index;
			break;
		}
	}

	if (index === -1) {
		throw new Error(`occurrence ${occurrence} of ${name} not found`);
	}

	const before = code.slice(0, index);
	const line = before.split("\n").length - 1;
	const character = index - (before.lastIndexOf("\n") + 1);

	return { line, character };
}

describe("classify parity (LSP raw-ts vs the shared corpus)", () => {
	for (const { code, name, expected, occurrence } of CLASSIFY_CORPUS) {
		test(`${expected}: ${code}`, () => {
			expect(classifyAt(code, occurrenceAt(code, name, occurrence))).toBe(expected);
		});
	}
});
