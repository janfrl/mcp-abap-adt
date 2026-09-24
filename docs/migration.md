# Migrating from mario-andreschak/mcp-abap-adt

This fork continues from [mario-andreschak/mcp-abap-adt](https://github.com/mario-andreschak/mcp-abap-adt) 1.2.0. All 16 tools keep their names and arguments, so prompts and workflows built against the original keep working.

## The minimum change

Point your MCP client at the new package name. Everything else can stay as it is:

```diff
 {
   "mcpServers": {
     "mcp-abap-adt": {
       "command": "npx",
-      "args": ["-y", "mcp-abap-adt"],
+      "args": ["-y", "@janfr/mcp-abap-adt"],
       "env": {
         "SAP_URL": "https://sap.example.com:44300",
         "SAP_USERNAME": "your_username",
         "SAP_PASSWORD": "your_password",
         "SAP_CLIENT": "100"
       }
     }
   }
 }
```

Your four `SAP_*` variables continue to work and now describe a system named `default`, which every tool call uses unless it names another one.

## What can break, and what to do about it

| Change | Symptom | Fix |
| --- | --- | --- |
| Certificates are verified | `TLS certificate verification failed ... (SELF_SIGNED_CERT_IN_CHAIN)` on the first tool call | Add `SAP_ALLOW_SELF_SIGNED=true` to the `env` block, or `"allowSelfSigned": true` to the system in a config file |
| Node.js 22.19 or newer required | The server fails to start | Update Node.js; the package is also ESM-only now |
| Package renamed | The old name keeps installing the original project | Use `@janfr/mcp-abap-adt` |
| `SAP_LANGUAGE` is honoured | ABAP texts arrive in a different language than before | Remove the variable, or set it to the language you want |

The certificate change is the one that will actually bite you. Version 1.2.0 passed `rejectUnauthorized: false` on every request and never read the `TLS_REJECT_UNAUTHORIZED` variable it documented, so **no** certificate was ever checked. Verification is now on by default and can be switched off per system.

`SAP_LANGUAGE` has the same history: documented, never read. Requests that used to run in the user's default logon language now use the configured one.

## Worth adopting afterwards

None of this is required, but it is why the fork exists:

1. **Several systems at once.** Replace the `env` block with a [config file](../README.md#config-file-any-number-of-systems) and pass `system` on a tool call to pick one. `ListSystems` shows what the server resolved.
2. **No password in a file.** If you use the SAP Fiori tools VS Code extension, set `"importFioriSystems": true` and your saved systems, including their passwords, are picked up from the OS keychain. Otherwise run `mcp-abap-adt store-credentials --system <name>` once. See [Credentials](../README.md#5-credentials).
3. **Drop the `.env` file.** It still works from the package directory and the working directory, but a config file with keychain credentials leaves no secret on disk.

## Also fixed along the way

- `GetPackage` encoded the package name twice, which broke namespaced packages such as `/DMO/FLIGHT`.
- Cookies were sent back including their attributes rather than as `name=value` pairs.
- Build tooling (TypeScript, Jest) shipped in `dependencies` and was installed at runtime by every `npx` invocation.
- The server reported itself as version `0.1.0` regardless of the released version.
- A missing environment variable killed the process before the MCP handshake, which clients could only show as an opaque startup failure. Configuration problems are now reported through `ListSystems`.

