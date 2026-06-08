// Declaration merging: an interface and a namespace of the same name (a very common
// "type + its companion namespace" idiom). Both contribute to one merged symbol `Summary`.
export interface Summary {
	total: number;
}

export namespace Summary {
	export const EMPTY: Summary = { total: 0 };

	export function isEmpty(s: Summary): boolean {
		return s.total === 0;
	}
}
