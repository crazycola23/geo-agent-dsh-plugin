# GEO DSH Plugin

Native DeepSeek Harness tools for the internal GEO workflow. It calls GEO's existing authenticated APIs; it does not modify the DSH upstream runtime or GEO backend.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2`
- Node.js `>=22.19`
- The package includes a DSH-native **GEO 工作台** configuration card under the plugin's settings page.
- Internal platform machine authentication through `POST /auth/machine-token`; GEO requests use the returned short-lived Sa-Token bearer credential
- Configure a GEO service origin in the card; the plugin appends `/geo` for business calls and uses `/auth/machine-token` for authentication.

Install this package in an isolated DSH profile, then fill in the GEO service address and one project authorization row per GEO project in the GEO 工作台 card. Each row stores the project ID, an optional display name, and that project's machine client credentials. Every configured project must use a unique Client ID; the card catches duplicates entered together and the plugin refuses to authenticate if configured projects share an ID. Credentials are written through DSH's write-only Credentials interface under project-specific references; the short-lived Bearer token is exchanged and cached separately for each project, never shown. The platform binds each machine client to a service account and tenant; give each account membership only in its corresponding GEO project so project isolation is enforced by the GEO backend. Set the optional evidence staging directory in the same card if evidence upload is needed. Use HTTPS for non-loopback service addresses, including private IPs. Do not store secrets in this repository, the Skill, or command-line arguments.

## Tools

- `geo_api`: call one exact operation from the generated GEO OpenAPI catalog. Supply the target `projectId`; the plugin uses that project's machine client and rejects requests whose path/query/body project ID differs. The selector is not added to the business request. The plugin validates path/query/body fields and refuses arbitrary hosts, headers, or undeclared fields.
- `geo_describe_operation`: inspect the current generated method, route, request schema, permission, and idempotency rule.
- `geo_list_evidence_files`: list allowed evidence file names and sizes from the configured staging folder; it never reads or returns their contents.
- `geo_upload_evidence`: upload one direct-child `.doc`, `.docx`, `.pdf`, or `.txt` file to the canonical multipart route. Absolute paths, traversal, symbolic links, and unsupported extensions are rejected.
- `geo_connection_status`: test one selected project's machine client and report its bound service account and token expiry without revealing the access token.

After saving the card, call `geo_connection_status` with each configured project ID to verify its machine authentication and bound service account. This check does not perform a GEO business write.

Authentication is specified separately in `../scrm-specs/30-contracts/platform-auth-machine-token.yaml` under `D-20261001`. It is an internal platform auth route, not part of GEO's business OpenAPI or OneGl's external API. The bound service account must be a non-admin tenant user with only required GEO permissions and project memberships. Machine secrets are BCrypt-hashed at rest and are not returned by client administration APIs.

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
