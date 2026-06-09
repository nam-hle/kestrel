// JSDoc release tags symantic surfaces as a navigation signal.

/** @deprecated use freshFn instead */
export function staleFn(): void {}

export function freshFn(): void {}

/** @internal not part of the public API */
export interface InternalShape {
	x: number;
}

/**
 * A pre-release surface.
 * @beta
 */
export const draft = 1;

/** @deprecated @internal both at once */
export function doubleTagged(): void {}
