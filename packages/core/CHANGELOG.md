# Changelog

## [0.2.0](https://github.com/nam-hle/kestrel/compare/core-v0.1.0...core-v0.2.0) (2026-06-08)


### ⚠ BREAKING CHANGES

* **core:** nested/member addresses change shape (`A.b` -> `A::b`) in CLI and MCP input and output. Pre-publish (no npm release), so no external impact.

### Bug Fixes

* **core:** drop built-in callees from context/call-hierarchy ([8f4e978](https://github.com/nam-hle/kestrel/commit/8f4e9788af13632e35e993f9ce54f899cf7b12ee)), closes [#81](https://github.com/nam-hle/kestrel/issues/81)
* **core:** key callHierarchy cycle guard on position, not node identity ([4245105](https://github.com/nam-hle/kestrel/commit/4245105f7aae78f6b76e2348187c139029757ffc)), closes [#38](https://github.com/nam-hle/kestrel/issues/38)
* **core:** reject invalid findUsages cursors in both engines ([f955019](https://github.com/nam-hle/kestrel/commit/f9550196146fd4b879eb5932ef9f3483bff37ce5)), closes [#39](https://github.com/nam-hle/kestrel/issues/39)
* **core:** reject malformed qualified names in parseQualifiedName ([a2cf5e3](https://github.com/nam-hle/kestrel/commit/a2cf5e3f94f8e7c1d64b978dc1e716a5891489e0)), closes [#37](https://github.com/nam-hle/kestrel/issues/37)
* **core:** resolve LSP-engine file paths against cwd, not tsconfig dir ([33f5943](https://github.com/nam-hle/kestrel/commit/33f594377aba9c52e77582146a5d5c296e7ab7d6)), closes [#79](https://github.com/nam-hle/kestrel/issues/79)
* **core:** use :: as the namespace separator in qualified names ([715b233](https://github.com/nam-hle/kestrel/commit/715b2335a4c3e4d96b9d0a1d91fabf10a2c894d9)), closes [#64](https://github.com/nam-hle/kestrel/issues/64)
