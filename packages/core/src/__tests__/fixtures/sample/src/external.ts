// A named import from an external (non-relative) module. The default engine cannot follow
// the import boundary to the declaration; addressing `external.ts:Node` should give an honest
// miss hinting `--engine lsp`, not a bare not-found (#100).
import type { Node } from "ts-morph";

export function nodeKind(node: Node): string {
	return node.getKindName();
}
