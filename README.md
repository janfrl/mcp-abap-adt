# mcp-abap-adt

An MCP server that lets tools like [Claude Code](https://claude.com/claude-code), [Claude Desktop](https://claude.com/download) or [Cline](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev) read from your SAP ABAP systems through ADT (ABAP Development Tools): program and class sources, table structures and contents, CDS views, packages, and more.

This is a fork of [mario-andreschak/mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) that adds:

- **Several SAP systems at once** — name them in a config file and pick one per tool call.
- **No passwords in files** — read credentials from the OS keychain, sharing entries with the SAP Fiori tools VS Code extension, or from environment variables.
- **Certificate verification on by default**, with a per-system opt-out.

## Contents

1. [Requirements](#1-requirements)
2. [Installation](#2-installation)
3. [Configuring SAP systems](#3-configuring-sap-systems)
4. [Credentials](#4-credentials)
5. [Connecting an MCP client](#5-connecting-an-mcp-client)
6. [Available tools](#6-available-tools)
7. [Troubleshooting](#7-troubleshooting)
8. [Further reading](#8-further-reading)

## 1. Requirements

- **Node.js 22 or newer.** Check with `node -v`.
- **An SAP ABAP system reachable over HTTP(S)** with the ADT services active. Your basis administrator can activate `/sap/bc/adt` in transaction `SICF`. You also need a user with the authorizations to read the objects you ask for.

## 2. Installation

Most MCP clients run the server for you; you rarely start it by hand. Two ways to install, differing in who decides when you update:

**Global install — you decide when to update.** The client entry is `"command": "mcp-abap-adt"` and never changes; updating is one deliberate command:

```bash
npm install -g @janfr/mcp-abap-adt
```

**Plain npx — updates arrive automatically.** The client entry is `npx -y @janfr/mcp-abap-adt`, which resolves `latest` on every start:

```bash
npx -y @janfr/mcp-abap-adt
```

That convenience has a price worth knowing: whatever gets published under this name runs on your machine at the next start, unseen — and this server holds your SAP credentials. If the npm account behind a package is ever compromised (supply-chain attack), auto-updating installations are the ones that execute the malicious version. Pinning a version in the npx call (`@janfr/mcp-abap-adt@2.5.0`) closes that window too, at the cost of editing every client to update.

### From source

```bash
git clone https://github.com/janfrl/mcp-abap-adt
cd mcp-abap-adt
npm install
npm run build
```

Then point your client at `node` with the absolute path to `dist/index.js`.

## 3. Configuring SAP systems

**Read the one row that describes you.** The rest of this section is detail on each route, not a sequence to work through.

| If you want | Use | Below |
| --- | --- | --- |
| One system, to try this out | the four `SAP_*` variables in your client's `env` block | [Environment variables](#environment-variables-single-system) |
| To adopt what SAP Fiori tools already knows | `SAP_IMPORT_FIORI_SYSTEMS=true`, nothing else | [Any setting without a file](#any-setting-without-a-file) |
| Several systems, with comments | a config file | [Config file](#config-file-any-number-of-systems) |
| One setup for several MCP clients, or a whole team | a user-level rc file, by hand or via `setup` | [docs/shared-configuration.md](docs/shared-configuration.md) |

The routes combine, and precedence runs command line → environment → config file → rc file. Wherever they overlap, `systems` merges entry by entry rather than replacing the whole set, so one route can adjust a single system and leave the rest alone.

### Environment variables (single system)

Setting all four of these gives you one system named `default`, which is what tool calls use when they don't name a system:

| Variable | Required | Meaning |
| --- | --- | --- |
| `SAP_URL` | yes | Base URL, e.g. `https://sap.example.com:44300` |
| `SAP_USERNAME` | yes | SAP user |
| `SAP_PASSWORD` | yes | Password |
| `SAP_CLIENT` | yes | Three digit client, e.g. `100` |
| `SAP_LANGUAGE` | no | Logon language, e.g. `EN` |
| `SAP_ALLOW_SELF_SIGNED` | no | Last resort: `true` skips certificate verification. Internal company CAs need nothing - the OS trust store is loaded automatically |
| `SAP_ALLOW_FREE_SQL` | no | `false` forbids ad-hoc SELECTs through `ExecuteQuery` |

Every `SAP_*` variable sets one field of the system named `default`, and each has the same name and meaning as the corresponding config-file key.

> `TLS_REJECT_UNAUTHORIZED=0` from earlier versions still works and means the same as `SAP_ALLOW_SELF_SIGNED=true`, but it prints a deprecation warning. The old name is inverted (`0` means "allow") and looks like Node's `NODE_TLS_REJECT_UNAUTHORIZED`, which it is not.

The variables can come from your MCP client's `env` block or from a `.env` file. Two locations are read: the directory the server is started in, and the package's own directory (where earlier versions kept it). A variable that is already set in the real environment wins over any `.env` file.

### Any setting without a file

Every setting the config file accepts can also be given on the command line or through the environment, so the common setup needs no file:

```json
{
  "command": "npx",
  "args": ["-y", "@janfr/mcp-abap-adt"],
  "env": {
    "SAP_IMPORT_FIORI_SYSTEMS": "true",
    "SAP_DEFAULT_SYSTEM": "DWM100"
  }
}
```

| | Meaning |
| --- | --- |
| `SAP_IMPORT_FIORI_SYSTEMS` / `--import-fiori-systems` | Adopt the systems saved in SAP Fiori tools |
| `SAP_DEFAULT_SYSTEM` / `--default-system <name>` | Which system a tool call uses when it names none |
| `MCP_ABAP_ADT_CONFIG_JSON` / `--config-json '<json>'` | Any setting, including per-system ones |

`MCP_ABAP_ADT_CONFIG_JSON` takes the same object a config file holds, which is what makes nested settings reachable. It is JSON rather than a set of flat variables on purpose: JSON carries its own types, so a `client` of `"100"` stays a string and nothing has to guess whether `010` means the client `010` or the number ten.

Adjusting one imported system, without repeating its url and client:

```json
"env": {
  "SAP_IMPORT_FIORI_SYSTEMS": "true",
  "MCP_ABAP_ADT_CONFIG_JSON": "{\"systems\":{\"DNG001\":{\"language\":\"EN\"}}}"
}
```

A file still earns its place once the configuration grows past a line or two — it takes comments and does not need escaping.

### Config file (any number of systems)

A file is optional — see above for the file-free route. Point at one explicitly with `--config <path>` or the `MCP_ABAP_ADT_CONFIG` environment variable. JSON, JSONC, YAML, TOML and `.ts` files all work.

Without an explicit path, the file is looked up as `mcp-abap-adt.config.*` in the **working directory the server is started in**. MCP clients rarely start it where you expect, so an absolute path via `--config` is the reliable choice.

```jsonc
{
  // Used when a tool call omits the "system" argument.
  "defaultSystem": "dev",

  // Adopt systems saved by the SAP Fiori tools VS Code extension.
  "importFioriSystems": true,

  "systems": {
    "dev": {
      "url": "https://dev.example.com:44300",
      "client": "100",
      "username": "DEVELOPER",
      "keychain": true
    },
    "qas": {
      "url": "https://qas.example.com:44300",
      "client": "200",
      "username": "DEVELOPER",
      "passwordEnv": "SAP_QAS_PASSWORD"
    },
    "sandbox": {
      "url": "https://vhcalnplci.dummy.nodomain:44300",
      "client": "001",
      "username": "DEVELOPER",
      "keychain": true,
      "allowSelfSigned": true,
      "language": "EN"
    }
  }
}
```

Per-system options:

| Option | Default | Meaning |
| --- | --- | --- |
| `url` | required | Base URL of the system |
| `client` | — | Three digit client. Omitted means the system default client. |
| `language` | — | Logon language |
| `username` | — | SAP user. May also come from the keychain entry. |
| `keychain` | `false` | Read the password from the OS keychain |
| `passwordEnv` | — | Name of an environment variable holding the password |
| `password` | — | Plaintext password. Works, but warns on startup. |
| `allowSelfSigned` | `false` | Accept untrusted certificates for this system |
| `allowFreeSql` | `true` | Allow `ExecuteQuery` to run ad-hoc SELECTs against this system |
| `timeoutMs` | `60000` | Request timeout in milliseconds |
| `authType` | `basic` | Only Basic authentication is implemented |

**Which system is the default?** In order: the `defaultSystem` you declared, then a system named `default` created from the `SAP_*` variables, then the only system if there is exactly one. Otherwise every tool call must name a system, and calls that don't get an error listing the valid names.

### One config for several clients, or a whole team

A user-level `.mcp-abap-adtrc` applies to every MCP client on the machine, and `setup --from <shared file>` turns onboarding a colleague into one command: config written, one password prompt, keychain filled. Both are described in [docs/shared-configuration.md](docs/shared-configuration.md).

### Adjusting an imported system

A config-file entry whose name matches an imported system is treated as an **override**: you only name what differs, and the imported `url`, `client` and `keychain` settings stay. For example, to pin the logon language of one imported system:

```jsonc
{
  "importFioriSystems": true,
  "systems": {
    // DNG001 keeps its imported url and client; only this one setting changes.
    "DNG001": { "language": "EN" }
  }
}
```

Spelling out `url` turns the entry into a full definition that replaces the imported one. If an override is invalid, the imported system stays usable and `ListSystems` reports that the override was ignored — a typo in one setting should not cost you access to the system.

The `SAP_*` variables only ever build the system named `default`; they do not affect imported or config-file systems.

Ask the model to call **`ListSystems`** at any time to see what the server actually resolved, including each system's `origin` (`config-file`, `fiori-tools` or `environment`) and any configuration problems. It returns no credentials.

## 4. Credentials

The server looks for a password in this order and uses the first one that applies: `password`, then `passwordEnv`, then the keychain.

### OS keychain (recommended)

Credentials live in the Windows Credential Manager, the macOS Keychain or libsecret — never in a file. The entries use the same naming as the SAP Fiori tools VS Code extension (service `fiori/v2/system`, account `<url>[/<client>]`), so the two tools share one entry.

If you already saved a system in **SAP Fiori tools**, you are done: set `"importFioriSystems": true` and the server picks up the system *and* its password. Systems using an authentication type other than basic are skipped with an explanatory message.

It is off by default deliberately: turning it on gives a model read access to every system you have saved, production among them — a decision to make rather than to inherit ([why, in full](docs/security.md#why-importfiorisystems-is-off-by-default)). A server with nothing configured names the systems it could adopt, so the option stays findable.

Otherwise store the password yourself:

```bash
mcp-abap-adt store-credentials --system dev
```

It asks for the username and a password that is not echoed (`--username <user>` skips the first question, also in the bulk and setup flows). An entry that already exists is only replaced after you confirm, because it may be one the Fiori tools extension wrote.

When one password serves several systems — the usual case with a central user administration — rotate them all at once:

```bash
mcp-abap-adt store-credentials --all
```

One password prompt, one summary, one confirmation, and every system with `"keychain": true` gets its entry rewritten (a subset works too: `--systems dev,qas`). Each existing entry keeps its own username, so mixed-user landscapes are fine. Storing never attempts a logon — verify afterwards with `doctor --login`.

### Environment variable

Name the variable in the config and let your MCP client provide it:

```jsonc
{ "systems": { "qas": { "url": "...", "client": "200", "username": "DEVELOPER", "passwordEnv": "SAP_QAS_PASSWORD" } } }
```

### A note on OAuth

On-premise ADT does not accept OAuth bearer tokens. `/sap/bc/adt` is a plain ICF node, while OAuth scopes in AS ABAP are a Gateway/OData construct, so there is nothing to authenticate against. OAuth would only be possible against the BTP ABAP Environment, which this server does not support yet. For on-premise systems, the keychain is the way to keep passwords out of files.

## 5. Connecting an MCP client

All clients follow the same shape: a command to run, and an `env` block for whatever the server should not have to look up itself.

**The examples below keep the password out of the client's config**, because a password sitting in a shared or synced JSON file is the thing this fork exists to avoid. They rely on the OS keychain, which is filled either by the SAP Fiori tools VS Code extension or by `store-credentials` — see [Credentials](#4-credentials). The `SAP_*` variables with a plaintext password are shown after each one; they work, and for a throwaway sandbox they are the shortest thing that does.

If you use more than one client — say Claude Desktop and Claude Code — put the systems in a [user-level `.mcp-abap-adtrc`](docs/shared-configuration.md) and keep every client's entry down to the bare command. Then there is one place to change a system rather than one per client.

`NODE_*` flags are Node's own and would have to be repeated in each client's `env` block, since a client passes on only a short list of variables. The one that used to matter here, `NODE_USE_SYSTEM_CA`, is no longer needed: the server loads the operating system's trust store by itself.

### Claude Code

```bash
claude mcp add --scope user mcp-abap-adt \
  --env SAP_IMPORT_FIORI_SYSTEMS=true \
  -- npx -y @janfr/mcp-abap-adt
```

That adopts every system saved in SAP Fiori tools, with their passwords, and no credential is written anywhere. Call `ListSystems` afterwards to see what it found. For systems you saved with `store-credentials` instead, name them in a config file or an rc file and leave the `env` block off entirely.

Keep `--scope user`, which registers the server for every directory; the default `local` ties it to the one you ran the command in. That is Claude Code's own behaviour rather than anything about this server — `claude mcp list` shows what the current directory has.

Without a keychain entry, the four `SAP_*` variables describe one system directly, at the cost of a password in Claude Code's config file:

```bash
claude mcp add --scope user mcp-abap-adt \
  --env SAP_URL=https://sap.example.com:44300 \
  --env SAP_USERNAME=your_username \
  --env SAP_PASSWORD=your_password \
  --env SAP_CLIENT=100 \
  -- npx -y @janfr/mcp-abap-adt
```

Or commit a `.mcp.json` in your project root. Because that file is shared, reference variables rather than writing secrets into it — Claude Code expands `${VAR}`:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "npx",
      "args": ["-y", "@janfr/mcp-abap-adt", "--config", "./mcp-abap-adt.config.jsonc"],
      "env": { "SAP_QAS_PASSWORD": "${SAP_QAS_PASSWORD}" }
    }
  }
}
```

### Claude Desktop

Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "mcp-abap-adt": {
      "command": "npx",
      "args": ["-y", "@janfr/mcp-abap-adt"],
      "env": {
        "SAP_IMPORT_FIORI_SYSTEMS": "true"
      }
    }
  }
}
```

Restart Claude Desktop afterwards. On Windows, use `"command": "npx.cmd"` if `npx` is not found.

This is the whole entry when the systems are in the keychain, and it does not change again when a system is added or a password rotates. With the settings in an rc file instead, even the `env` block goes away.

The plaintext alternative, for a system that is not in the keychain:

```json
"env": {
  "SAP_URL": "https://sap.example.com:44300",
  "SAP_USERNAME": "your_username",
  "SAP_PASSWORD": "your_password",
  "SAP_CLIENT": "100"
}
```

Note where that file lives: Claude Desktop's config is readable by anything running as you, and on a managed machine it may be backed up or synced.

### Cline

Same JSON, in `cline_mcp_settings.json` (VS Code settings → "Cline MCP Settings" → Edit in settings.json).

Since Cline runs inside VS Code, this is where sharing credentials with SAP Fiori tools pays off: save the system once in Fiori tools, then use a config file with `"importFioriSystems": true` and no `env` block at all.

## 6. Available tools

Every tool below takes an optional **`system`** argument naming a configured system. Omit it to use the default.

| Tool | Description | Arguments |
| --- | --- | --- |
| `ListSystems` | List configured systems, the default, and configuration problems. Returns no credentials. | — |
| `ExecuteQuery` | Run a read-only ABAP SQL SELECT, returned as CSV | `query`, `maxRows` (default 100, max 5000), `timeoutMs` (default ≥ 60 s) |
| `GetProgram` | ABAP program source | `program_name` |
| `GetClass` | ABAP class source | `class_name` |
| `GetInterface` | ABAP interface source | `interface_name` |
| `GetFunctionGroup` | Function group source | `function_group` |
| `GetFunction` | Function module source | `function_name`, `function_group` |
| `GetInclude` | Include source | `include_name` |
| `GetStructure` | DDIC structure | `structure_name` |
| `GetTable` | Table structure | `table_name` |
| `GetTableContents` | All columns of a table, as CSV | `table_name`, `max_rows` (default 100, max 5000) |
| `GetSystemInfo` | Release and installed software component versions (CVERS) | — |
| `GetPackage` | Package contents | `package_name` |
| `GetTypeInfo` | Domain or data element | `type_name` |
| `GetCDSView` | CDS view (DDL source) | `cds_view_name` |
| `GetTransaction` | Transaction details | `transaction_name` |
| `SearchObject` | Quick search across objects | `query`, `maxResults` (default 100) |
| `GetBehaviorDefinition` | RAP behavior definition (needs ~NW 7.54 / S/4HANA) | `behavior_definition_name` |
| `GetServiceDefinition` | RAP service definition (needs ~NW 7.54 / S/4HANA) | `service_definition_name` |
| `CheckSyntax` | Non-activating syntax check of source text you supply | `object_type`, `object_name`, `source` |
| `GetWhereUsed` | Where-used list for a program, class, interface, table, or CDS view | `object_type`, `object_name`, `max_results` (default 100, max 1000) |
| `GetAtcFindings` | ABAP Test Cockpit findings for one object | `object_type`, `object_name`, `check_variant` (default: the system's), `max_findings` (default 100, max 1000) |

### Reading data

`ExecuteQuery` runs a single ABAP SQL SELECT and returns CSV. Prefer it over `GetTableContents` whenever only part of a table is needed — projecting and filtering is what keeps an answer small:

```
SELECT carrid, connid FROM sflight WHERE carrid = 'LH'
SELECT COUNT(*) AS cnt FROM t000
```

Dialect notes, since this is ABAP SQL and not the SQL you may expect: exactly one SELECT, no trailing semicolon, `ASCENDING`/`DESCENDING` instead of `ASC`/`DESC`, and no `LIMIT` clause — use the `maxRows` argument, which defaults to 100 and is capped at 5000.

Nothing here can write — SAP itself turns anything but a query into a syntax error, and the server checks again on top. Every query runs under the SAP authorisations of the configured user, which remains the real boundary on what can be read. `"allowFreeSql": false` forbids ad-hoc queries per system, with a caveat worth reading first: [the security model](docs/security.md#read-only-by-design) explains why that setting makes a model read more data, not less.

### Checking code before it is applied elsewhere

`CheckSyntax` runs SAP's own non-activating check — the one the ABAP editor runs on every keystroke — against source text you pass in. What gets checked is that text, never what the system currently stores, and nothing is saved or activated.

The object you name only lends context: its kind, its includes, its class hierarchy. **It does not have to exist.** SAP checks the supplied text either way, so brand-new code can be validated without first finding a real object to attach it to — which is the more useful half for anything that generates code. POST is required because ADT expects the source in the request body, exactly as `ExecuteQuery` already POSTs a read-only SELECT.

### Finding what depends on an object

`GetWhereUsed` runs the same lookup as Eclipse ADT's Ctrl+Shift+H. Two things about the answer are worth knowing, because SAP's raw response is misleading:

- **Only real usages are listed.** SAP flattens a tree into one list, in which packages and function groups appear as grouping nodes for the hits beneath them. They are not usages, and the count of dropped nodes is reported so the filter can be checked.
- **The total is always named, even when the list is cut.** A widely used standard object can have hundreds of usages, so `max_results` defaults to 100. A header line states the real total, so a shortened answer can never be mistaken for a short one.

### Quality rules a system actually enforces

`GetAtcFindings` runs the ABAP Test Cockpit against one object and returns its findings with priority, line, the sub-object they sit in, the check that fired and its message. That is a different question from `CheckSyntax`: syntax says whether code compiles, ATC says whether it obeys the rules this system has decided to enforce — which a model cannot know from training data.

Which rules those are depends entirely on the **check variant**. There is no universal default, so `check_variant` is optional and falls back to the variant the system itself has configured (`systemCheckVariant` in the ATC customizing), exactly as ADT does for "Run ABAP Test Cockpit".

A variant the system does not offer is **rejected**, with the names it does offer, rather than run. That matters more than it sounds: SAP does not refuse an unusable variant but silently runs its own default instead, and nothing in the response says which variant executed — so without the check an answer could name a variant that never ran. [The security model](docs/security.md#the-one-tool-that-leaves-something-behind) has the measurements behind that.

Three outcomes are deliberately kept apart, because conflating them is how a model concludes that unchecked code is fine:

- **Findings** — listed per object, with `[prio 1]` the most severe.
- **No findings** — the object was checked and nothing fired.
- **Not checked** — ATC returned no result for it at all. The name may not exist, or the object lies outside the variant's scope; SAP standard code usually does. This is reported as its own answer, never as "no findings".

A run that did not complete is announced on the first line as a tool failure, ahead of any count, and findings from the checks that did run are still reported below it.

Two limits worth knowing: ATC generally only has rules for custom code, so SAP standard objects tend to come back with nothing; and `max_findings` is enforced by this server, because the `maximumVerdicts` that ADT sends was observed not to cap anything.

Unlike every other tool here, this one leaves something behind on the server — an ATC worklist that stays valid for ten days and is then removed by ATC housekeeping. [The security model](docs/security.md#the-one-tool-that-leaves-something-behind) sets out what that is and why it still counts as read-only.

## 7. Troubleshooting

**Start with `doctor`.** One table shows every configured system, where its credentials come from, whether the keychain actually holds the entry, and whether the host is reachable — with the usual causes (VPN, internal CA) named next to the failure:

```bash
npx -y @janfr/mcp-abap-adt doctor
```

Reachability is probed without authentication, so running it never touches a failed-logon counter. Add `--login` for exactly one real logon attempt per system when you want the password itself verified. Inside a chat, `ListSystems` answers the configuration half of the same questions.

**"TLS certificate verification failed"** — on a company network the certificate is usually fine: the server loads the operating system's trust store automatically, so what your browser trusts, it trusts. `doctor` tells the two cases apart. If the certificate genuinely cannot be validated (a self-signed sandbox), `"allowSelfSigned": true` on that system — or an [override entry](#adjusting-an-imported-system) for an imported one — switches verification off there. Mechanics, older-Node fallback and the opt-out live in [docs/security.md](docs/security.md#tls-and-the-trust-stores).

**"No keychain entry for system ..."** — run `mcp-abap-adt store-credentials --system <name>`, or save the system in SAP Fiori tools. Note that the entry is keyed by URL *and* client, so `https://host` and `https://host/100` are different entries.

**"No answer from system ... within ... ms"** — the request ran out of its time budget. Every request gets 60 seconds by default. For one heavy query, pass `timeoutMs` on the `ExecuteQuery` call (up to 10 minutes) — a model reading the error can retry with it directly. If a system is generally slow, raise `"timeoutMs"` in its configuration entry instead, which applies to every tool.

**"No system was given and no default system is configured"** — you have more than one system and no `defaultSystem`. Either set one or pass `system` in the call.

**SAP returns 401 or 403** — check the user and client, and that the user may use ADT. Some ADT endpoints need `S_DEVELOP` authorizations.

**"The session for system … had expired, and the re-login was rejected"** — the server recovers from an expired ADT session by itself (logging off in SAP GUI kills it, since both share the user's security session): it drops the dead session and retries once with the stored credentials. This message means that retry was rejected too, so the credentials themselves no longer work — the password changed or the user is locked. Update the keychain entry with `store-credentials` or in SAP Fiori tools. The server deliberately never retries more than once, to keep a stale password from locking the user out.

**Nothing works and you want to poke at it directly** — set `MCP_ABAP_ADT_DEBUG=1` to trace every ADT call with status and duration, on stderr and as MCP log notifications; credentials, cookies and query bodies are never logged. Tracing details and how to drive the server with the MCP Inspector: [docs/debugging.md](docs/debugging.md).

## 8. Further reading

- **[Shared configuration](docs/shared-configuration.md)** — the user-level rc file, and team onboarding with `setup --from`.
- **[Security model](docs/security.md)** — why this server cannot write, the TLS trust-store mechanics, OAuth, and how logon attempts are kept away from SAP lock counters.
- **[Debugging](docs/debugging.md)** — tracing every ADT call, and driving the server with the MCP Inspector.
- **[Migrating from mario-andreschak/mcp-abap-adt](docs/migration.md)** — what changes for a 1.x setup, what can break, and the one-line minimum change. All 16 original tools keep their names and arguments.
- **[Contributing](CONTRIBUTING.md)** — the build, test and release commands, and why a few tooling choices are the way they are.

## License

MIT. Originally created by [mario-andreschak](https://github.com/mario-andreschak/mcp-abap-adt).
