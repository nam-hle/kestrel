# Changelog

## [0.3.2](https://github.com/nam-hle/symantic/compare/v0.3.1...v0.3.2) (2026-06-13)


### Features

* **core:** Find symbol kind classification, --exclude-tests, --kind ([#110](https://github.com/nam-hle/symantic/issues/110)) ([f272681](https://github.com/nam-hle/symantic/commit/f2726814601833f2f966eb840cc6d7dcff7ac0ca))
* **core:** Scope find symbol by file path ([fd81235](https://github.com/nam-hle/symantic/commit/fd812355ef3f389180aed06c683a3f646e6f149b))


### Bug Fixes

* **core:** Hint toward :: when a member is addressed with a dot ([4d3fd63](https://github.com/nam-hle/symantic/commit/4d3fd635af4986b021c51a53849ce7a3258ca591)), closes [#101](https://github.com/nam-hle/symantic/issues/101)
* **core:** Honest miss with --engine lsp hint for external imports ([0df8b82](https://github.com/nam-hle/symantic/commit/0df8b82bbad0f7260a6ef414ed0daee115312a0e)), closes [#100](https://github.com/nam-hle/symantic/issues/100)
* **core:** Lsp file ops give an honest miss, not a raw ENOENT ([c72624e](https://github.com/nam-hle/symantic/commit/c72624e9052b36b38f9a50da92dad5334e5b53d2)), closes [#116](https://github.com/nam-hle/symantic/issues/116)
* **core:** View members enumerates object-literal const properties ([150d7d4](https://github.com/nam-hle/symantic/commit/150d7d4565c9c82ba3d89cb5d3ab7d3ad1642b92)), closes [#95](https://github.com/nam-hle/symantic/issues/95)

## [0.3.1](https://github.com/nam-hle/symantic/compare/v0.3.0...v0.3.1) (2026-06-09)


### Internal

* Release 0.3.1 ([3df2faa](https://github.com/nam-hle/symantic/commit/3df2faa9555d7aa36fd327c6f7c33ef0b044ccc6))
* Release 0.3.1 ([f8ac888](https://github.com/nam-hle/symantic/commit/f8ac88863900a7137abd6831d71940eda9630d1b))

## [0.3.0](https://github.com/nam-hle/symantic/compare/core/v0.2.0...core/v0.3.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* package names, binary, MCP server name, env var, and ledger path all change. Pre-publish, so no external impact.
* **core:** nested/member addresses change shape (`A.b` -> `A::b`) in CLI and MCP input and output. Pre-publish (no npm release), so no external impact.

### Features

* **core:** Compact outline / refs / usage text output ([fd4f5ab](https://github.com/nam-hle/symantic/commit/fd4f5ab1b3c63ab64378113ac797e4873fe49e58))
* **core:** Fold a declaration merge in view members (membersByName) ([5953035](https://github.com/nam-hle/symantic/commit/5953035f68017ba63cfb75ca0b06f8e1819a7af5))
* **core:** Surface JSDoc release tags in outline, members and view symbol ([c7054e0](https://github.com/nam-hle/symantic/commit/c7054e055b62dc8f79786ff47852d85c0b4b640b)), closes [#105](https://github.com/nam-hle/symantic/issues/105)


### Bug Fixes

* **core:** Address shorthand methods inside object literals ([5b00073](https://github.com/nam-hle/symantic/commit/5b0007399fe2879ea85349468585667036937d64))
* **core:** Annotate namespaces/enums/type-aliases in view outline ([1a5dee1](https://github.com/nam-hle/symantic/commit/1a5dee1954ea06e7ce32a4102e4d65dd4eec529a))
* **core:** Drop built-in callees from context/call-hierarchy ([8f4e978](https://github.com/nam-hle/symantic/commit/8f4e9788af13632e35e993f9ce54f899cf7b12ee)), closes [#81](https://github.com/nam-hle/symantic/issues/81)
* **core:** Index whole project so lsp find symbol sees every file ([af45356](https://github.com/nam-hle/symantic/commit/af45356287014796beaeb5c401d3bf7688dd92f9))
* **core:** Key callHierarchy cycle guard on position, not node identity ([4245105](https://github.com/nam-hle/symantic/commit/4245105f7aae78f6b76e2348187c139029757ffc)), closes [#38](https://github.com/nam-hle/symantic/issues/38)
* **core:** Label nested named statements in view body ([9cd8849](https://github.com/nam-hle/symantic/commit/9cd8849c676bbe088810b89908517f30a2df7874))
* **core:** Lsp engine descends into namespace and function scopes ([a15e035](https://github.com/nam-hle/symantic/commit/a15e035209be1fa3cb7b4a4b58ce37a378ac4bda)), closes [#102](https://github.com/nam-hle/symantic/issues/102) [#103](https://github.com/nam-hle/symantic/issues/103)
* **core:** Lsp view symbol returns just the interface member, not the whole interface ([9e3ed26](https://github.com/nam-hle/symantic/commit/9e3ed262c2e02d923266adc16a4ae5511978707d)), closes [#104](https://github.com/nam-hle/symantic/issues/104)
* **core:** Make tsgo an optional dependency, not a hard one ([997c6f3](https://github.com/nam-hle/symantic/commit/997c6f3a73b3930c0f8ae12cf208afbecc3eea46)), closes [#69](https://github.com/nam-hle/symantic/issues/69)
* **core:** Order view outline by source position, not container-first ([cc5cd4f](https://github.com/nam-hle/symantic/commit/cc5cd4f948349521180b5762bc03ef01a5a62559))
* **core:** Reject invalid findUsages cursors in both engines ([f955019](https://github.com/nam-hle/symantic/commit/f9550196146fd4b879eb5932ef9f3483bff37ce5)), closes [#39](https://github.com/nam-hle/symantic/issues/39)
* **core:** Reject malformed qualified names in parseQualifiedName ([a2cf5e3](https://github.com/nam-hle/symantic/commit/a2cf5e3f94f8e7c1d64b978dc1e716a5891489e0)), closes [#37](https://github.com/nam-hle/symantic/issues/37)
* **core:** Resolve LSP-engine file paths against cwd, not tsconfig dir ([33f5943](https://github.com/nam-hle/symantic/commit/33f594377aba9c52e77582146a5d5c296e7ab7d6)), closes [#79](https://github.com/nam-hle/symantic/issues/79)
* **core:** Use :: as the namespace separator in qualified names ([715b233](https://github.com/nam-hle/symantic/commit/715b2335a4c3e4d96b9d0a1d91fabf10a2c894d9)), closes [#64](https://github.com/nam-hle/symantic/issues/64)


### Documentation

* Rework root README + add subpackage READMEs ([8388bb2](https://github.com/nam-hle/symantic/commit/8388bb27c21c55b18368886d4fda53d65fff694a))
* **skill:** Teach concept-orientation via find symbol --contains + :: addressing ([b2877c7](https://github.com/nam-hle/symantic/commit/b2877c7f4b8909a576b85ab19d35cb8ba650c43d))
* Surface find symbol --contains; nudge on empty exact match ([4cdbea9](https://github.com/nam-hle/symantic/commit/4cdbea991584ff9e975f36208db7542e85fac6f5))


### Internal

* **core:** Dedup isTestFile + guard classify parity ([4e7bd22](https://github.com/nam-hle/symantic/commit/4e7bd22f9990ecd2fecc83917fd4c5c0330a4a88)), closes [#83](https://github.com/nam-hle/symantic/issues/83)
* Raise coverage on version, gain, and the async engine bridge ([4c0a59e](https://github.com/nam-hle/symantic/commit/4c0a59e4bd3310540a7f2c2591d3fb2422e85e4e))
* Rebrand kestrel to symantic ([f3ff609](https://github.com/nam-hle/symantic/commit/f3ff6096dd0d5e467bdc4f7cc49612d26aaac87a))
* Release core v0.2.0 ([#87](https://github.com/nam-hle/symantic/issues/87)) ([1dd6b8d](https://github.com/nam-hle/symantic/commit/1dd6b8db230298eaa42898dda4a7ecf0d8691beb))

## [0.2.0](https://github.com/nam-hle/kestrel/compare/core/v0.1.0...core/v0.2.0) (2026-06-08)


### ⚠ BREAKING CHANGES

* **core:** nested/member addresses change shape (`A.b` -> `A::b`) in CLI and MCP input and output. Pre-publish (no npm release), so no external impact.

### Bug Fixes

* **core:** Drop built-in callees from context/call-hierarchy ([8f4e978](https://github.com/nam-hle/kestrel/commit/8f4e9788af13632e35e993f9ce54f899cf7b12ee)), closes [#81](https://github.com/nam-hle/kestrel/issues/81)
* **core:** Key callHierarchy cycle guard on position, not node identity ([4245105](https://github.com/nam-hle/kestrel/commit/4245105f7aae78f6b76e2348187c139029757ffc)), closes [#38](https://github.com/nam-hle/kestrel/issues/38)
* **core:** Make tsgo an optional dependency, not a hard one ([997c6f3](https://github.com/nam-hle/kestrel/commit/997c6f3a73b3930c0f8ae12cf208afbecc3eea46)), closes [#69](https://github.com/nam-hle/kestrel/issues/69)
* **core:** Reject invalid findUsages cursors in both engines ([f955019](https://github.com/nam-hle/kestrel/commit/f9550196146fd4b879eb5932ef9f3483bff37ce5)), closes [#39](https://github.com/nam-hle/kestrel/issues/39)
* **core:** Reject malformed qualified names in parseQualifiedName ([a2cf5e3](https://github.com/nam-hle/kestrel/commit/a2cf5e3f94f8e7c1d64b978dc1e716a5891489e0)), closes [#37](https://github.com/nam-hle/kestrel/issues/37)
* **core:** Resolve LSP-engine file paths against cwd, not tsconfig dir ([33f5943](https://github.com/nam-hle/kestrel/commit/33f594377aba9c52e77582146a5d5c296e7ab7d6)), closes [#79](https://github.com/nam-hle/kestrel/issues/79)
* **core:** Use :: as the namespace separator in qualified names ([715b233](https://github.com/nam-hle/kestrel/commit/715b2335a4c3e4d96b9d0a1d91fabf10a2c894d9)), closes [#64](https://github.com/nam-hle/kestrel/issues/64)


### Internal

* **core:** Dedup isTestFile + guard classify parity ([4e7bd22](https://github.com/nam-hle/kestrel/commit/4e7bd22f9990ecd2fecc83917fd4c5c0330a4a88)), closes [#83](https://github.com/nam-hle/kestrel/issues/83)
