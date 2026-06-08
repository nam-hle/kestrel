/**
 * Whether a path is a test/spec file. Shared by both engines so the heuristic lives
 * in one place. Paths are forward-slashed (ts-morph normalizes; LSP results too).
 */
export function isTestFile(file: string): boolean {
	return /(\.test\.|\.spec\.|\/__tests__\/|\/e2e\/)/.test(file);
}
