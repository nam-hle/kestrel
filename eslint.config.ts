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
				project: ["./packages/*/tsconfig.eslint.json"]
			}
		}
	},
	{
		files: ["**/*.test.ts"],
		...vitest.configs.recommended,
		rules: {
			...vitest.configs.recommended.rules,
			"vitest/expect-expect": ["error", { assertFunctionNames: ["expect", "expectTypeOf"] }]
		}
	}
);

export default configs;
