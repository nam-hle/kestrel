import { makeCircle, Circle } from "./shapes.js";

export function totalArea(count: number): number {
	let sum = 0;
	for (let i = 0; i < count; i++) {
		const c: Circle = makeCircle(i);
		sum += c.area();
	}
	return sum;
}

export const averageArea = (count: number): number => {
	const total = totalArea(count);
	if (count === 0) {
		return 0;
	}
	return total / count;
};

export class AreaService {
	// Arrow-bound class property — a common selector/handler shape.
	public compute = (count: number): number => {
		return averageArea(count);
	};
}

export interface AreaCalculators {
	mean: (count: number) => number;
}

// Factory returning an object literal of arrow methods — a common selectors shape.
export function makeCalculators(): AreaCalculators {
	return {
		mean: (count: number): number => {
			return averageArea(count);
		}
	};
}

// Factory with a nested function declaration returned by shorthand — another common shape.
export function makeSelectors(): AreaCalculators {
	function mean(count: number): number {
		return averageArea(count);
	}

	return { mean };
}
