# Changelog

## [0.3.0](https://github.com/nam-hle/symantic/compare/mcp/v0.2.0...mcp/v0.3.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* package names, binary, MCP server name, env var, and ledger path all change. Pre-publish, so no external impact.

### Features

* **core:** Compact outline / refs / usage text output ([fd4f5ab](https://github.com/nam-hle/symantic/commit/fd4f5ab1b3c63ab64378113ac797e4873fe49e58))
* Report version in CLI (--version) + MCP serverInfo ([693a021](https://github.com/nam-hle/symantic/commit/693a021d18783b86802b4809b147005b9927216b)), closes [#58](https://github.com/nam-hle/symantic/issues/58)


### Bug Fixes

* **mcp:** Serialize concurrent calls + bound the warm-engine cache ([ccc71c2](https://github.com/nam-hle/symantic/commit/ccc71c25c6bc987a6238ee996fd3366a0d9f9dc3)), closes [#84](https://github.com/nam-hle/symantic/issues/84)
* **mcp:** Validate tsConfig path with a clear error ([8611613](https://github.com/nam-hle/symantic/commit/86116133f65735a5faba667419651fbcf7a7bbf2)), closes [#40](https://github.com/nam-hle/symantic/issues/40)


### Documentation

* Rework root README + add subpackage READMEs ([8388bb2](https://github.com/nam-hle/symantic/commit/8388bb27c21c55b18368886d4fda53d65fff694a))


### Internal

* Lockstep versioning across core, cli, mcp ([#106](https://github.com/nam-hle/symantic/issues/106)) ([7d3fbc9](https://github.com/nam-hle/symantic/commit/7d3fbc9fbca0616f1c3db5654119bb0609bc3e35))
* **mcp:** Extract warm-engine lifecycle into a tested EnginePool ([6f4443e](https://github.com/nam-hle/symantic/commit/6f4443ebe16c69e204f34cf54bb775b7f4456172))
* Raise coverage on version, gain, and the async engine bridge ([4c0a59e](https://github.com/nam-hle/symantic/commit/4c0a59e4bd3310540a7f2c2591d3fb2422e85e4e))
* Rebrand kestrel to symantic ([f3ff609](https://github.com/nam-hle/symantic/commit/f3ff6096dd0d5e467bdc4f7cc49612d26aaac87a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @symantic/core bumped to 0.3.0
