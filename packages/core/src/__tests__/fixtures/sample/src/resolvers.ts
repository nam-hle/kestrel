export interface Greeter {
	greet(name: string): string;
}

// Two const-object implementors in ONE file (tests name + under-count).
export const politeGreeter: Greeter = {
	greet(name: string): string {
		return `Hello, ${name}`;
	}
};

export const casualGreeter: Greeter = {
	greet(name: string): string {
		return `Hey ${name}`;
	}
};

export class LoudGreeter implements Greeter {
	greet(name: string): string {
		return `HELLO ${name.toUpperCase()}`;
	}
}
