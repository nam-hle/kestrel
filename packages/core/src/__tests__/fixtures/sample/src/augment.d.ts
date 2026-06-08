// Ambient declaration of a module whose name is a quoted, dotted string. The quotes
// and dots must not be treated as namespace nesting by the outline renderer (#64).
declare module "@scope.org/pkg.sub" {
	export interface Extra {
		flag: boolean;
	}
}
