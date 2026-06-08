// A top-level interface declared BEFORE a namespace, to pin source-order rendering:
// the namespace's members sit at higher line numbers, so a container-floats-to-top bug
// would print the namespace before TopFirst even though TopFirst comes first in source.
export interface TopFirst {
	id: string;
}

export namespace LaterNamespace {
	export const value = 1;

	export function helper(): number {
		return value;
	}
}
