import nadle from "@nadle/eslint-config";
import vitest from "@vitest/eslint-plugin";
import tsEslint, { type ConfigArray } from "typescript-eslint";

const configs: ConfigArray = tsEslint.config(
	...nadle.configs.recommended,
	{
		ignores: ["**/dist", "**/.nadle", "**/coverage", "**/node_modules/", "**/*.config.ts", "packages/core/src/__tests__/fixtures/**"]
	},
	{
		languageOptions: {
			parserOptions: {
				tsconfigRootDir: import.meta.dirname,
				project: ["./tsconfig.check.json"]
			}
		}
	},
	{
		files: ["**/*.test.ts"],
		...vitest.configs.recommended,
		rules: {
			...vitest.configs.recommended.rules,
			"vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectTypeOf"] }],
			// vitest is a root devDependency shared by every package, not re-declared per package.
			"n/no-extraneous-import": ["error", { allowModules: ["vitest"] }]
		}
	}
);

export default configs;
