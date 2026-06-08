import { test, expect, describe } from "vitest";

import { serialize, clearSerialKey } from "../serialize.js";

/** A task that records overlap: increments active on entry, fails if >1 concurrent. */
function makeTracker() {
	let active = 0;
	let maxActive = 0;

	const task = async (): Promise<void> => {
		active++;
		maxActive = Math.max(maxActive, active);
		await new Promise((r) => setTimeout(r, 5));
		active--;
	};

	return { task, peak: () => maxActive };
}

describe("serialize", () => {
	test("same key runs one at a time (no overlap)", async () => {
		const { task, peak } = makeTracker();

		await Promise.all([serialize("k", task), serialize("k", task), serialize("k", task)]);

		expect(peak()).toBe(1);
		clearSerialKey("k");
	});

	test("preserves call order on one key", async () => {
		const order: number[] = [];
		const push = (n: number) => async () => {
			await new Promise((r) => setTimeout(r, n === 1 ? 10 : 1));
			order.push(n);
		};

		await Promise.all([serialize("o", push(1)), serialize("o", push(2)), serialize("o", push(3))]);

		expect(order).toEqual([1, 2, 3]);
		clearSerialKey("o");
	});

	test("different keys run concurrently", async () => {
		const { task, peak } = makeTracker();

		await Promise.all([serialize("a", task), serialize("b", task)]);

		expect(peak()).toBe(2);
		clearSerialKey("a");
		clearSerialKey("b");
	});

	test("a rejection does not wedge the chain", async () => {
		await expect(serialize("e", () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");

		await expect(serialize("e", () => Promise.resolve("ok"))).resolves.toBe("ok");
		clearSerialKey("e");
	});
});
