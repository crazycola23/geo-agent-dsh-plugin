# GEO DSH Plugin

Native DeepSeek Harness tools for the internal GEO workflow. It calls GEO's existing authenticated APIs; it does not modify the DSH upstream runtime or GEO backend.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2`
- Node.js `>=22.19`
- The package includes a DSH-native **GEO 工作台** configuration card under the plugin's settings page.
- GEO project API tokens per D-20261001-02: the plugin sends the project's `geop_` bearer directly; there is no token exchange
- Configure a GEO service origin in the card; the plugin appends `/geo` for business calls and uses `/auth/project-token-context` to validate a project token.

Install this package in an isolated DSH profile, then fill in the GEO service address and one project authorization row per GEO project in the GEO 工作台 card. Each row stores the project ID, an optional display name, and that project's API token. Every configured project must use a unique token; the card catches duplicates entered together and the plugin refuses to authenticate if configured projects share a token. Tokens are written through DSH's write-only Credentials interface under project-specific references and are never displayed back. The token is bound server-side to one tenant, one GEO Project and its issuer, so project isolation is enforced by the GEO backend, not by the client. Set the optional evidence staging directory in the same card if evidence upload is needed. Use HTTPS for non-loopback service addresses, including private IPs. Do not store secrets in this repository, the Skill, or command-line arguments.

## Tools

- `geo_api`: call one exact operation from the generated GEO OpenAPI catalog. Supply the target `projectId`; the plugin uses that project's API token and rejects requests whose path/query/body project ID differs. The selector is not added to the business request. The plugin validates path/query/body fields and refuses arbitrary hosts, headers, or undeclared fields.
- `geo_describe_operation`: inspect the current generated method, route, request schema, permission, and idempotency rule.
- `geo_list_evidence_files`: list allowed evidence file names and sizes from the configured staging folder; it never reads or returns their contents.
- `geo_upload_evidence`: upload one direct-child `.doc`, `.docx`, `.pdf`, or `.txt` file to the canonical multipart route. Absolute paths, traversal, symbolic links, and unsupported extensions are rejected.
- `geo_connection_status`: test one selected project's API token and report its bound project, token name, scopes and expiry without revealing the bearer.

After saving the card, call `geo_connection_status` with each configured project ID to verify its project token and binding. This check does not perform a GEO business write.

Authentication is specified by [D-20261001-02](../scrm-specs/20-decisions/D-20261001-02-GEO项目API令牌.md). Tokens are created by the interactive GEO project owner in the project record; the platform `client_credentials` machine-auth route remains as a platform capability but is not used by this plugin. The issuer must be a non-admin interactive GEO user, and token scopes are re-derived from that user's current permissions on every request. Tokens are stored BCrypt-free as SHA-256 digests server-side and are never returned by any listing API.

The plugin applies this allowlist in each existing and newly created agent's own DSH context, so the dedicated profile exposes only these GEO tools without masking tools in unrelated DSH agents. Every non-GET API call and evidence upload requires one DSH operator approval. The GEO backend remains authoritative for authorization and state validation. Provider callbacks, admin-only publish-target configuration and audit reads/exports, project archive/restore/deletion, content-task deletion, the tenant-wide `geo:collector:account:admin` directory, raw evidence file reads, customer report external delivery, cost mutations, and tenant-wide budget-pool or budget-release operations (including `GET /budget/pool`) are excluded from the tool catalog. Project-scoped budget and expense reads remain available.

The plugin never retries automatically. It returns `outcome: unknown` with the original idempotency key when an operation may have reached GEO without a confirmed response. Reconcile the existing GEO record before any recovery. Evidence uploads derive a stable UUID from project ID and file contents; a deliberate new upload can use a different valid UUID only after the operator confirms that intent.

Image/video file upload uses the separate Resource/OSS path and is outside this GEO OpenAPI plugin. Existing project media can be listed or bound through contracted GEO operations; new media must be uploaded in the GEO UI for this version.

## OpenAPI generation and tests

`src/generated/openapi.catalog.json` and `../geo-workflow/references/capability-map.md` are generated from `../scrm-specs/30-contracts/08-openapi.yaml`. Current SHA-256: `0229313233b4ddd49823c09735c07ab5ab26b5befa5125b7a8a5a6635c93f965`.

```powershell
npm ci --ignore-scripts
npm run build:client
npm test
npm run validate
npm run generate:catalog
```

Generation rewrites the runtime catalog and Skill capability map. Review the `workflow.md` references manually after canonical business-rule changes. Unit tests and a successful DSH profile composition do not prove live GEO or OneGl execution.
