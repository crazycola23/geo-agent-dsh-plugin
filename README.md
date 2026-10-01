# GEO DSH Plugin

Native DeepSeek Harness tools for the internal GEO workflow. It calls GEO's existing authenticated APIs; it does not modify the DSH upstream runtime or GEO backend.

## Compatibility

- DeepSeek Harness `0.2.0-rc.2`
- Node.js `>=22.19`
- Internal platform machine authentication through `POST /auth/machine-token`; GEO requests use the returned short-lived Sa-Token bearer credential
- `GEO_API_BASE_URL` must be an HTTP(S) origin only; the plugin appends the OpenAPI server path `/geo`.

Install this local package in an isolated DSH profile. Store `GEO_MACHINE_CLIENT_ID` and `GEO_MACHINE_CLIENT_SECRET` in that profile's DSH Settings → Credentials. The plugin exchanges them for a token bound server-side to one GEO service account; the access token stays in process memory. Set `GEO_EVIDENCE_DIRECTORY` to an operator-owned staging directory if evidence upload is needed. Do not store secrets in this repository, the Skill, or command-line arguments.

## Tools

- `geo_api`: call one exact operation from the generated GEO OpenAPI catalog. The plugin validates path/query/body fields and refuses arbitrary hosts, headers, or undeclared fields.
- `geo_describe_operation`: inspect the current generated method, route, request schema, permission, and idempotency rule.
- `geo_list_evidence_files`: list allowed evidence file names and sizes from the configured staging folder; it never reads or returns their contents.
- `geo_upload_evidence`: upload one direct-child `.doc`, `.docx`, `.pdf`, or `.txt` file to the canonical multipart route. Absolute paths, traversal, symbolic links, and unsupported extensions are rejected.
- `geo_connection_status`: report whether origin, credential, evidence folder, and OpenAPI catalog are configured without revealing their values.

Authentication is specified separately in `../scrm-specs/30-contracts/platform-auth-machine-token.yaml` under `D-20261001`. It is an internal platform auth route, not part of GEO's business OpenAPI or OneGl's external API. The bound service account must be a non-admin tenant user with only required GEO permissions and project memberships. Machine secrets are BCrypt-hashed at rest and are not returned by client administration APIs.

The plugin applies this allowlist in each existing and newly created agent's own DSH context, so the dedicated profile exposes only these GEO tools without masking tools in unrelated DSH agents. Every non-GET API call and evidence upload requires one DSH operator approval. The GEO backend remains authoritative for authorization and state validation. Provider callbacks, admin-only publish-target configuration and audit reads/exports, project archive/restore/deletion, content-task deletion, the tenant-wide `geo:collector:account:admin` directory, raw evidence file reads, customer report external delivery, cost mutations, and tenant-wide budget-pool or budget-release operations (including `GET /budget/pool`) are excluded from the tool catalog. Project-scoped budget and expense reads remain available.

The plugin never retries automatically. It returns `outcome: unknown` with the original idempotency key when an operation may have reached GEO without a confirmed response. Reconcile the existing GEO record before any recovery. Evidence uploads derive a stable UUID from project ID and file contents; a deliberate new upload can use a different valid UUID only after the operator confirms that intent.

Image/video file upload uses the separate Resource/OSS path and is outside this GEO OpenAPI plugin. Existing project media can be listed or bound through contracted GEO operations; new media must be uploaded in the GEO UI for this version.

## OpenAPI generation and tests

`src/generated/openapi.catalog.json` and `../geo-workflow/references/capability-map.md` are generated from `../scrm-specs/30-contracts/08-openapi.yaml`. Current SHA-256: `0229313233b4ddd49823c09735c07ab5ab26b5befa5125b7a8a5a6635c93f965`.

```powershell
npm ci --ignore-scripts
npm test
npm run validate
npm run generate:catalog
```

Generation rewrites the runtime catalog and Skill capability map. Review the `workflow.md` references manually after canonical business-rule changes. Unit tests and a successful DSH profile composition do not prove live GEO or OneGl execution.
