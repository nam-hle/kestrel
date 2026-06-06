import type { Shape } from "./shapes.js";

export class Square implements Shape {
	constructor(private side: number) {}
	area(): number {
		return this.side * this.side;
	}
}
