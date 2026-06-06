import { tasks, ExecTask, DeleteTask } from "nadle";

// --- Building ---

tasks.register("build", ExecTask, { args: ["-b"], command: "tsc" }).config({
	group: "Building",
	description: "Build all packages (tsc project references)"
});

tasks.register("typecheck", ExecTask, { args: ["-b"], command: "tsc" }).config({
	group: "Building",
	description: "Type-check all project references"
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
