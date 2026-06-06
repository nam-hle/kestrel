export interface Shape {
	area(): number;
}

export class Circle implements Shape {
	constructor(private radius: number) {}
	area(): number {
		return Math.PI * this.radius * this.radius;
	}
}

export function makeCircle(radius: number): Circle {
	return new Circle(radius);
}

const helper = 42;
export { helper };

export interface Box<T, U> {
	value: T;
	meta: U;
}
