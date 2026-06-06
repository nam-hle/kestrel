export namespace Model {
	export interface Node {
		id: string;
	}

	export namespace Inner {
		export interface Node {
			deep: boolean;
		}
	}
}

export namespace Runtime {
	export interface Node {
		live: boolean;
	}
}
