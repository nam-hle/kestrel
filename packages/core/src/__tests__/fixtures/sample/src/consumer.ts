import { makeCircle, Circle } from "./shapes.js";

export function totalArea(count: number): number {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const c: Circle = makeCircle(i);
    sum += c.area();
  }
  return sum;
}
