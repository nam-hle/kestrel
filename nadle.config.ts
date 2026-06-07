import { tasks, ExecTask, DeleteTask } from "nadle";

// --- Building ---
//
// `emit` runs tsc -b over the project references: it type-checks and emits every
// package's src (composite). `typecheck` is a separate whole-repo pass that also
// covers test files (excluded from the emit). `bundle` then re-emits the cli/mcp
// bins as single files via tsup. `build` ties the three together.

tasks.register("emit", ExecTask, { command: "tsc", args: ["-b"] }).config({
	group: "Building",
	description: "Type-check and emit every package's src (tsc project references)"
});

tasks.register("typecheck", ExecTask, { command: "tsc", args: ["-p", "tsconfig.check.json", "--noEmit"] }).config({
	group: "Building",
	dependsOn: ["emit"],
	description: "Type-check every package including tests (resolves @kestrel/core from its emitted dist)"
});

tasks.register("bundle", ExecTask, { command: "tsup" }).config({
	group: "Building",
	dependsOn: ["emit"],
	description: "Bundle the cli and mcp bins (tsup, one root config)"
});

tasks.register("build").config({
	group: "Building",
	dependsOn: ["emit", "typecheck", "bundle"],
	description: "Type-check, emit, and bundle every package"
});

// --- Testing ---

tasks.register("testUnit", ExecTask, { args: ["run"], command: "vitest" }).config({
	group: "Testing",
	dependsOn: ["build"],
	description: "Run unit tests"
});

tasks.register("test").config({
	group: "Testing",
	dependsOn: ["testUnit"],
	description: "Run all tests"
});

tasks.register("testCoverage", ExecTask, { args: ["run", "--coverage"], command: "vitest" }).config({
	group: "Testing",
	dependsOn: ["build"],
	description: "Run unit tests with coverage (thresholds enforced in vitest.config.ts)"
});

// --- Checking ---

tasks.register("eslint", ExecTask, { args: ["."], command: "eslint" }).config({
	group: "Checking",
	description: "Lint all files with ESLint"
});

tasks
	.register("prettier", ExecTask, { command: "prettier", args: ["--check", "."] })
	.config({ group: "Checking", description: "Check formatting with Prettier" });

tasks.register("check").config({
	group: "Checking",
	dependsOn: ["eslint", "prettier"],
	description: "Run all checks (lint, format)"
});

// --- Formatting ---

tasks.register("fixEslint", ExecTask, { command: "eslint", args: [".", "--fix"] }).config({
	group: "Formatting",
	description: "Fix lint issues with ESLint"
});

tasks
	.register("fixPrettier", ExecTask, { command: "prettier", args: ["--write", "."] })
	.config({ group: "Formatting", description: "Format all files with Prettier" });

tasks.register("format").config({
	group: "Formatting",
	dependsOn: ["fixEslint", "fixPrettier"],
	description: "Fix lint and format all files"
});

// --- Maintenance ---

tasks
	.register("clean", DeleteTask, { paths: ["**/dist/**", "**/.nadle/**", "**/*.tsbuildinfo"] })
	.config({ group: "Maintenance", description: "Delete build artifacts" });
