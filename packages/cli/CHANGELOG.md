# Changelog

## [0.3.0](https://github.com/nam-hle/symantic/compare/cli/v0.2.0...cli/v0.3.0) (2026-06-09)


### ⚠ BREAKING CHANGES

* package names, binary, MCP server name, env var, and ledger path all change. Pre-publish, so no external impact.

### Features

* **cli:** Discover tsconfig by default; --tsconfig now optional ([d5cd4a7](https://github.com/nam-hle/symantic/commit/d5cd4a700c35b1e6bbbfabd40304d7cddc16bce1)), closes [#82](https://github.com/nam-hle/symantic/issues/82)
* **cli:** View body --source + DX hints for body and find symbol ([370c4e7](https://github.com/nam-hle/symantic/commit/370c4e7796ecdee627973b88b63836651668efba))
* **core:** Compact outline / refs / usage text output ([fd4f5ab](https://github.com/nam-hle/symantic/commit/fd4f5ab1b3c63ab64378113ac797e4873fe49e58))
* **core:** Fold a declaration merge in view members (membersByName) ([5953035](https://github.com/nam-hle/symantic/commit/5953035f68017ba63cfb75ca0b06f8e1819a7af5))
* Report version in CLI (--version) + MCP serverInfo ([693a021](https://github.com/nam-hle/symantic/commit/693a021d18783b86802b4809b147005b9927216b)), closes [#58](https://github.com/nam-hle/symantic/issues/58)


### Bug Fixes

* **cli:** Make gain ledger tests hermetic on Windows ([a51b1b7](https://github.com/nam-hle/symantic/commit/a51b1b766eed099979d5dbf244ab4b48cc4d7b8b))


### Documentation

* Rework root README + add subpackage READMEs ([8388bb2](https://github.com/nam-hle/symantic/commit/8388bb27c21c55b18368886d4fda53d65fff694a))
* Surface find symbol --contains; nudge on empty exact match ([4cdbea9](https://github.com/nam-hle/symantic/commit/4cdbea991584ff9e975f36208db7542e85fac6f5))


### Internal

* Lockstep versioning across core, cli, mcp ([#106](https://github.com/nam-hle/symantic/issues/106)) ([7d3fbc9](https://github.com/nam-hle/symantic/commit/7d3fbc9fbca0616f1c3db5654119bb0609bc3e35))
* Raise coverage on version, gain, and the async engine bridge ([4c0a59e](https://github.com/nam-hle/symantic/commit/4c0a59e4bd3310540a7f2c2591d3fb2422e85e4e))
* Rebrand kestrel to symantic ([f3ff609](https://github.com/nam-hle/symantic/commit/f3ff6096dd0d5e467bdc4f7cc49612d26aaac87a))


### Dependencies

* The following workspace dependencies were updated
  * dependencies
    * @symantic/core bumped to 0.3.0
