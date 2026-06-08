// Exercises every modifier flag the outline surfaces: export, abstract, static, readonly,
// async, optional, default.
export abstract class Widget {
	static readonly kind = "widget";
	readonly id: string = "";
	label?: string;

	abstract render(): string;

	async load(): Promise<void> {
		return Promise.resolve();
	}

	static create(): Widget | undefined {
		return undefined;
	}
}

export interface WidgetProps {
	title: string;
	subtitle?: string;
}

export default function makeWidget(): Widget | undefined {
	return Widget.create();
}
