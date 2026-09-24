# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries up to and including 2.0.0 were written by hand in the
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/) style. From 2.0.0
onwards they are generated from conventional commits by
[changelogen](https://github.com/unjs/changelogen) via `npm run release`, which
is why the style changes further up the file.

## v2.7.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.6.0...v2.7.0)

### 🚀 Features

- **cli:** Add and remove one system without touching JSON or the rc file ([45b085e](https://github.com/janfrl/mcp-abap-adt/commit/45b085e))
- **cli:** Set the default system, and print the version, from the command line ([2b23ccc](https://github.com/janfrl/mcp-abap-adt/commit/2b23ccc))

### 🩹 Fixes

- **cli:** Refuse an unknown command instead of silently starting the server ([1fe7c75](https://github.com/janfrl/mcp-abap-adt/commit/1fe7c75))
- **cli:** Show the help for a bare command in a terminal instead of waiting ([d0e49fd](https://github.com/janfrl/mcp-abap-adt/commit/d0e49fd))
- **cli:** Report Ctrl+C in a prompt as a cancel, not a fatal error ([8ce9dba](https://github.com/janfrl/mcp-abap-adt/commit/8ce9dba))

### 📖 Documentation

- **cli:** Cut the help down to the commands and a few words each ([c12d472](https://github.com/janfrl/mcp-abap-adt/commit/c12d472))

### 📦 Build

- Inspect the package before it is published ([466a53c](https://github.com/janfrl/mcp-abap-adt/commit/466a53c))
- **deps:** Update the dependencies, and state the Node version undici needs ([fa4a0ce](https://github.com/janfrl/mcp-abap-adt/commit/fa4a0ce))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.6.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.5.0...v2.6.0)

### 🚀 Features

- **cli:** Let setup --from read the team list from an https URL ([9e53f3d](https://github.com/janfrl/mcp-abap-adt/commit/9e53f3d))
- **cli:** Let setup read the systems JSON pasted into the terminal ([7345d4f](https://github.com/janfrl/mcp-abap-adt/commit/7345d4f))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.5.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.4.0...v2.5.0)

### 🚀 Features

- **connection:** Log ADT calls and session replacements ([d1dfcaf](https://github.com/janfrl/mcp-abap-adt/commit/d1dfcaf))
- **server:** Send diagnostics to the client, not only to stderr ([8ecb4b6](https://github.com/janfrl/mcp-abap-adt/commit/8ecb4b6))
- **cli:** Store one password for many systems ([dceb1f7](https://github.com/janfrl/mcp-abap-adt/commit/dceb1f7))
- **cli:** Add a doctor command ([e00db0e](https://github.com/janfrl/mcp-abap-adt/commit/e00db0e))
- **cli:** Add setup --from for shared team configuration ([5eb497f](https://github.com/janfrl/mcp-abap-adt/commit/5eb497f))
- Trust what the operating system trusts, without an env-block entry ([2483fc1](https://github.com/janfrl/mcp-abap-adt/commit/2483fc1))
- **config:** Give every request a minute rather than thirty seconds ([ae49502](https://github.com/janfrl/mcp-abap-adt/commit/ae49502))
- Add GetWhereUsed for usage references (UC2) ([a3639f4](https://github.com/janfrl/mcp-abap-adt/commit/a3639f4))
- Add GetSystemInfo for release and component versions ([45eab46](https://github.com/janfrl/mcp-abap-adt/commit/45eab46))
- Add CheckSyntax for non-activating syntax checks (UC9) ([3ef9dea](https://github.com/janfrl/mcp-abap-adt/commit/3ef9dea))
- Add GetAtcFindings for ATC findings (UC7) ([85bcf5a](https://github.com/janfrl/mcp-abap-adt/commit/85bcf5a))
- **server:** Annotate every tool's effect, and bound SearchObject ([38fce29](https://github.com/janfrl/mcp-abap-adt/commit/38fce29))

### 🩹 Fixes

- **cli:** Tell doctor's TLS failures apart, and name the one setting that fixes them ([97a3cf9](https://github.com/janfrl/mcp-abap-adt/commit/97a3cf9))
- **cli:** Stop decorating healthy systems with a status that reads like an error ([a752bb5](https://github.com/janfrl/mcp-abap-adt/commit/a752bb5))
- **cli:** Default the bulk write confirmation to yes ([1fcd8e9](https://github.com/janfrl/mcp-abap-adt/commit/1fcd8e9))
- **connection:** Load the OS trust store where connections are born ([7167113](https://github.com/janfrl/mcp-abap-adt/commit/7167113))
- **lib:** Keep NODE_EXTRA_CA_CERTS when loading the OS trust store ([626ed94](https://github.com/janfrl/mcp-abap-adt/commit/626ed94))
- **cli:** Rebuild doctor's TLS diagnosis on structure instead of display text ([7d7d37e](https://github.com/janfrl/mcp-abap-adt/commit/7d7d37e))
- **cli:** Make the credential prompts safe for pipes and mixed landscapes ([2c7753f](https://github.com/janfrl/mcp-abap-adt/commit/2c7753f))
- **cli:** Stop setup from writing what the rc file cannot carry ([3c99be5](https://github.com/janfrl/mcp-abap-adt/commit/3c99be5))
- **lib:** Load the trust store after the configuration, and read the skip strictly ([139e290](https://github.com/janfrl/mcp-abap-adt/commit/139e290))
- **cli:** Write the team file's own words into the rc file, not the schema's ([8a1e3f4](https://github.com/janfrl/mcp-abap-adt/commit/8a1e3f4))
- **connection:** Tell a timed-out user how long the budget was and where to raise it ([fa2df92](https://github.com/janfrl/mcp-abap-adt/commit/fa2df92))
- Raise the CVERS row limit so a system with many add-ons is not cut ([36e9377](https://github.com/janfrl/mcp-abap-adt/commit/36e9377))
- List only real usages in GetWhereUsed, and cap the list ([59acaa2](https://github.com/janfrl/mcp-abap-adt/commit/59acaa2))
- **atc:** Refuse check variants the system does not offer ([860c7a8](https://github.com/janfrl/mcp-abap-adt/commit/860c7a8))
- **atc:** Use the configured timeout instead of a floor of its own ([8ab6ffb](https://github.com/janfrl/mcp-abap-adt/commit/8ab6ffb))
- **cli:** Run main() when started through the bin symlink npm installs ([2517cba](https://github.com/janfrl/mcp-abap-adt/commit/2517cba))
- **handlers:** Let CheckSyntax refuse an answer it cannot read ([9bcf241](https://github.com/janfrl/mcp-abap-adt/commit/9bcf241))
- **cli:** Let setup store credentials for the connection that is really used ([2d11071](https://github.com/janfrl/mcp-abap-adt/commit/2d11071))
- **cli:** Make doctor count a missing credential source as a finding ([d1346e4](https://github.com/janfrl/mcp-abap-adt/commit/d1346e4))
- **config:** Refuse credentials inside a url, and warn about plain http ([acdcd73](https://github.com/janfrl/mcp-abap-adt/commit/acdcd73))
- **config:** Warn about plain http on every configuration route ([bae5167](https://github.com/janfrl/mcp-abap-adt/commit/bae5167))
- **server:** Annotate ListSystems like the other read-only tools ([f33c945](https://github.com/janfrl/mcp-abap-adt/commit/f33c945))

### 💅 Refactors

- Share asArray and the URI-fragment parser ([806f729](https://github.com/janfrl/mcp-abap-adt/commit/806f729))
- **server:** Name the two annotation sets instead of passing a boolean ([e137b25](https://github.com/janfrl/mcp-abap-adt/commit/e137b25))

### 📖 Documentation

- Document store-credentials --all, doctor, and setup --from ([b10f9e0](https://github.com/janfrl/mcp-abap-adt/commit/b10f9e0))
- Teach allowSelfSigned as the last resort it is ([2c5d057](https://github.com/janfrl/mcp-abap-adt/commit/2c5d057))
- Bring server.json back in step, and document --username ([a15dc83](https://github.com/janfrl/mcp-abap-adt/commit/a15dc83))
- Align README and server.json with the reviewed behaviour ([abedf8e](https://github.com/janfrl/mcp-abap-adt/commit/abedf8e))
- Explain the timeout knobs where the error lands, and the npx pinning trade-off ([847845d](https://github.com/janfrl/mcp-abap-adt/commit/847845d))
- Recommend the global install for permanent setups ([e00403d](https://github.com/janfrl/mcp-abap-adt/commit/e00403d))
- Present both install routes as an update-policy choice ([d9ab053](https://github.com/janfrl/mcp-abap-adt/commit/d9ab053))
- Move the deep dives to docs/, keep the README at user altitude ([1488093](https://github.com/janfrl/mcp-abap-adt/commit/1488093))
- Move the migration guide into docs/ ([61b29e4](https://github.com/janfrl/mcp-abap-adt/commit/61b29e4))
- Name the read-only POST tools in the security model ([f41c4be](https://github.com/janfrl/mcp-abap-adt/commit/f41c4be))
- Describe CheckSyntax by what it actually does ([0e7e0d5](https://github.com/janfrl/mcp-abap-adt/commit/0e7e0d5))
- Document the three tools from the first cycle ([eda75d4](https://github.com/janfrl/mcp-abap-adt/commit/eda75d4))
- **atc:** Give the worklist its real lifetime, trim the README ([263cc30](https://github.com/janfrl/mcp-abap-adt/commit/263cc30))
- **atc:** Give the worklist its real lifetime in the README too ([4ab1774](https://github.com/janfrl/mcp-abap-adt/commit/4ab1774))
- Use neutral example names instead of internal system ids ([ca80ddd](https://github.com/janfrl/mcp-abap-adt/commit/ca80ddd))
- Lead the README with a quick start, and move the deep dives to docs/ ([65a141e](https://github.com/janfrl/mcp-abap-adt/commit/65a141e))
- Onboard through setup --from alone, and drop the absolute claims ([91a7a09](https://github.com/janfrl/mcp-abap-adt/commit/91a7a09))
- **security:** Say verification is on by default, not always on ([d7aad08](https://github.com/janfrl/mcp-abap-adt/commit/d7aad08))
- Say where the systems file may live, and show a real path ([64b8124](https://github.com/janfrl/mcp-abap-adt/commit/64b8124))

### 📦 Build

- Sync server.json into the release commit automatically ([e11af4b](https://github.com/janfrl/mcp-abap-adt/commit/e11af4b))
- **deps:** Take the non-breaking audit fixes ([7d8ba85](https://github.com/janfrl/mcp-abap-adt/commit/7d8ba85))

### 🏡 Chore

- Bump server.json for the 2.5.0 release ([301200a](https://github.com/janfrl/mcp-abap-adt/commit/301200a))
- Bump server.json for the 2.5.0 release" ([2e1bef2](https://github.com/janfrl/mcp-abap-adt/commit/2e1bef2))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))
- Elias-Bechtle <elias.moegerle@bechtle.com>

## v2.4.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.3.0...v2.4.0)

### 🚀 Features

- **build:** Ship type declarations ([bddac82](https://github.com/janfrl/mcp-abap-adt/commit/bddac82))
- **server:** Give ExecuteQuery a per-call time budget ([d7558ab](https://github.com/janfrl/mcp-abap-adt/commit/d7558ab))
- **lib:** Report the database execution time with each query result ([6d0fe0c](https://github.com/janfrl/mcp-abap-adt/commit/6d0fe0c))

### 🩹 Fixes

- **connection:** Recover when SAP invalidates the security session ([5a47d59](https://github.com/janfrl/mcp-abap-adt/commit/5a47d59))
- **connection:** Reduce SAP's HTML answer pages to one line ([6ecdea9](https://github.com/janfrl/mcp-abap-adt/commit/6ecdea9))
- **connection:** Name the real cause when the CSRF prime fails ([8576afc](https://github.com/janfrl/mcp-abap-adt/commit/8576afc))
- **connection:** Re-read credentials after a 401, so a rotated password heals ([2fdc5d7](https://github.com/janfrl/mcp-abap-adt/commit/2fdc5d7))

### 📖 Documentation

- Split migration and contributing out, lead section 3 with a chooser ([988cf98](https://github.com/janfrl/mcp-abap-adt/commit/988cf98))
- Describe the session recovery and the ExecuteQuery time budget ([2520cf3](https://github.com/janfrl/mcp-abap-adt/commit/2520cf3))
- **connection:** Record that the 401 session path is system-dependent ([227d515](https://github.com/janfrl/mcp-abap-adt/commit/227d515))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.3.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.2.0...v2.3.0)

### 🚀 Features

- **config:** Name the unused Fiori systems when nothing is configured ([4810cb4](https://github.com/janfrl/mcp-abap-adt/commit/4810cb4))

### 📖 Documentation

- Tell readers to use --scope user, and point at the rc file ([8bd7ffe](https://github.com/janfrl/mcp-abap-adt/commit/8bd7ffe))
- Trim the note on Claude Code's server scopes ([04d06fc](https://github.com/janfrl/mcp-abap-adt/commit/04d06fc))
- Lead the client examples with the keychain, not a plaintext password ([07977fb](https://github.com/janfrl/mcp-abap-adt/commit/07977fb))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.2.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.1.0...v2.2.0)

### 🚀 Features

- **config:** Configure everything without a file ([71118bf](https://github.com/janfrl/mcp-abap-adt/commit/71118bf))
- **config:** Accept a client that an rc file coerced into a number ([324674f](https://github.com/janfrl/mcp-abap-adt/commit/324674f))

### 🩹 Fixes

- **cli:** Report a malformed --config-json through ListSystems ([643325a](https://github.com/janfrl/mcp-abap-adt/commit/643325a))

### 💅 Refactors

- **config:** Let c12 apply the command line and environment layer ([3aff262](https://github.com/janfrl/mcp-abap-adt/commit/3aff262))

### 📖 Documentation

- Fix three stale or misplaced passages ([34ce1c4](https://github.com/janfrl/mcp-abap-adt/commit/34ce1c4))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## v2.1.0

[compare changes](https://github.com/janfrl/mcp-abap-adt/compare/v2.0.0...v2.1.0)

### 🚀 Features

- **lib:** Parse and compact the ADT data preview payload ([59adda2](https://github.com/janfrl/mcp-abap-adt/commit/59adda2))
- **config:** Add allowFreeSql, on by default ([2742e01](https://github.com/janfrl/mcp-abap-adt/commit/2742e01))
- **server:** Add ExecuteQuery and return table data as CSV ([db1e1af](https://github.com/janfrl/mcp-abap-adt/commit/db1e1af))

### 🩹 Fixes

- **lib:** Treat a missing totalRows as unknown rather than zero ([975aca4](https://github.com/janfrl/mcp-abap-adt/commit/975aca4))
- **lib:** State the row total only when rows were actually withheld ([3019946](https://github.com/janfrl/mcp-abap-adt/commit/3019946))

### 📖 Documentation

- Correct where the config file is looked up ([737cb46](https://github.com/janfrl/mcp-abap-adt/commit/737cb46))
- Document ExecuteQuery, the CSV output and allowFreeSql ([ffdc1a0](https://github.com/janfrl/mcp-abap-adt/commit/ffdc1a0))

### ❤️ Contributors

- Jan Fröhlich ([@janfrl](https://github.com/janfrl))

## [2.0.0] - 2026-08-06

First release of the [janfrl](https://github.com/janfrl/mcp-abap-adt) fork,
published as `@janfr/mcp-abap-adt`.

### Added
- Support for several SAP systems at once. Systems are named in a config file
  (`mcp-abap-adt.config.{jsonc,yaml,ts,...}`) found in the working directory or
  given explicitly via `--config` or `MCP_ABAP_ADT_CONFIG`, and every tool takes
  an optional `system` argument.
- `ListSystems` tool reporting the configured systems, the default one and any
  configuration problems, without exposing credentials.
- Credentials from the OS keychain, using the same entries as the SAP Fiori
  tools VS Code extension, plus `passwordEnv` for environment references.
- `importFioriSystems` adopts systems already saved in SAP Fiori tools,
  including their stored passwords. A config entry with the same name overrides
  individual settings on an imported system instead of replacing it, so
  allowing a certificate does not mean repeating its url and client.
- `ListSystems` reports each system's `origin` (`config-file`, `fiori-tools` or
  `environment`), which is where a change has to be made.
- `SAP_ALLOW_SELF_SIGNED` mirrors the `allowSelfSigned` config key in name and
  polarity. `TLS_REJECT_UNAUTHORIZED` still works as a deprecated alias and
  warns; it was inverted and looked like Node's own variable without being it.
- `store-credentials` subcommand for writing a password to the OS keychain
  without VS Code.
- Per-system `allowSelfSigned`, `timeoutMs` and `language` settings.
- GitHub Actions CI building and testing on Node 22 and 24, on Linux and
  Windows, with oxlint (including type-aware rules) and an oxfmt format check.
- `npm run typecheck` covers the tests as well, which the build config excludes
  and vitest only transpiles.

### Changed
- Tools are registered through `McpServer.registerTool` with zod schemas,
  replacing the hand-maintained JSON schemas and dispatch switch.
- HTTP goes through ofetch on undici instead of axios; configuration loading
  uses c12 instead of dotenv; tests run on vitest instead of jest.
- Connection state (CSRF token, cookies, credentials, TLS policy) is per
  system rather than module-global, so two systems cannot corrupt each other's
  session.
- The server starts even when the configuration is broken and explains the
  problem through `ListSystems`, instead of exiting before the MCP handshake.
- The advertised server version comes from package.json instead of a hardcoded
  `0.1.0`.

### Fixed
- `SAP_LANGUAGE` and `TLS_REJECT_UNAUTHORIZED` are honoured. Both were
  documented but read nowhere.
- `GetPackage` no longer encodes the package name twice, which broke
  namespaced packages such as `/DMO/FLIGHT`.
- Cookies are echoed as `name=value` pairs instead of whole `Set-Cookie`
  strings including their attributes.

### Removed
- axios, dotenv, jest and ts-jest. Build tooling moved out of `dependencies`,
  where it was being installed at runtime.

### Breaking
- Requires Node.js 22 or newer, and the package is ESM-only.
- TLS certificates are verified. Earlier versions disabled verification
  unconditionally; systems with self-signed certificates now need
  `allowSelfSigned` or `TLS_REJECT_UNAUTHORIZED=0`.
- Handler functions take a connection as their first argument.

## [1.1.0] - 2025-02-19

### Added
- New `GetTransaction` tool to retrieve ABAP transaction details.
  - Allows fetching transaction details using the ADT endpoint `/sap/bc/adt/repository/informationsystem/objectproperties/values`.
  - Added documentation in README.md.

## [0.1.2] - 2025-02-18

### Changed
- Added Jest Test Script `index.test.ts` available through `npm test`
- Enhanced `makeAdtRequest` method to support:
  - Custom headers through an optional parameter
  - Query parameters through an optional `params` parameter
- Improved `handleGetPackage` method to use ADT's nodeContent API
  - Now uses POST request with proper XML payload
  - Added specific content type headers for nodeContent endpoint
  - Added filtering to return only objects with URI 
- Improved CSRF token handling in utils.ts
  - Added automatic CSRF token fetching for POST/PUT requests
  - Enhanced token extraction to work with error responses
  - Added cookie management for better session handling
  - Implemented singleton axios instance for consistent state
  - Added proper cleanup for test environments

## [0.1.1] - 2025-02-13

### Added
- New `GetInterface` tool to retrieve ABAP interface source code
  - Allows fetching source code of ABAP interfaces using the ADT endpoint `/sap/bc/adt/oo/interfaces/`
  - Similar functionality to GetClass but for interfaces
  - Added documentation in README.md

## [0.1.0] - Initial Release

### Added
- Initial release of the MCP ABAP ADT server
- Basic ABAP object retrieval functionality
- Support for programs, classes, function modules, and more
- Documentation and setup instructions
