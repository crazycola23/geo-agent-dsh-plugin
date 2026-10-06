import Schema from '@deepseek-ai/schemastery';

const defaultTimeout = Number.isInteger(Number(process.env.GEO_API_TIMEOUT_MS))
  && Number(process.env.GEO_API_TIMEOUT_MS) >= 1_000
  && Number(process.env.GEO_API_TIMEOUT_MS) <= 120_000
  ? Number(process.env.GEO_API_TIMEOUT_MS)
  : 30_000;

/**
 * Values editable from the DSH plugin configuration page. The connection
 * credentials intentionally live in DSH Credentials, not this settings form.
 */
export const Config = Schema.object({
  apiBaseUrl: Schema.string().default(process.env.GEO_API_BASE_URL ?? '').volatile(),
  // Gateway path prefix that sits between the origin and the OpenAPI server path.
  // Frontend deployments usually route API calls through something like /prod-api
  // so the SPA fallback never swallows them; a non-browser client such as this
  // plugin does not know about it and would otherwise request /geo/... and receive
  // the HTML page. Empty means "no prefix", which is correct when the origin itself
  // already proxies the contract's server path.
  apiBasePath: Schema.string().default(process.env.GEO_API_BASE_PATH ?? '').volatile(),
  evidenceDirectory: Schema.string().default(process.env.GEO_EVIDENCE_DIRECTORY ?? '').volatile(),
  timeoutMs: Schema.number().min(1_000).max(120_000).step(1_000).default(defaultTimeout).volatile(),
  // Tool-level isolation switch. When true (default) every agent in the running
  // DSH runtime is restricted to this plugin's own tools — correct inside a
  // dedicated GEO-only DSH home, catastrophic in a shared profile because it
  // masks every unrelated tool. Set false in the profile's cordis.patch.yml to
  // keep the GEO tools without the restriction. See setup.md.
  restrictTools: Schema.boolean().default(true).volatile(),
  // Fact-lifecycle write gate. 'ask' (default) keeps the interactive flow: the
  // agent presents each fact candidate and waits for the operator's per-item
  // decision. 'agent' is an explicit operator opt-in that lets the running
  // agent apply its own judgment on fact-lifecycle writes (new revisions,
  // confirm, disable, dispute, reenable) without the plugin-level approval
  // prompt. It never covers evidence uploads or publish / detect / report
  // writes, and it does not change GEO's own server-side authorization.
  factConfirmPolicy: Schema.string().default('ask').volatile(),
  // Write-delegation policies, one per domain (see POLICY_DOMAINS in index.js).
  // 'ask' (default) keeps the operator prompt for that domain's writes; the
  // explicit 'agent' value delegates them to the running agent's judgment.
  // Unknown values fall back to 'ask', and publish-confirm-class writes can
  // never be delegated regardless of these settings (HARD_ASK_WRITES).
  contentPrepPolicy: Schema.string().default('ask').volatile(),
  contentGenerationPolicy: Schema.string().default('ask').volatile(),
  detectionPolicy: Schema.string().default('ask').volatile(),
  reportPolicy: Schema.string().default('ask').volatile(),
  projects: Schema.array(Schema.object({
    projectId: Schema.string(),
    name: Schema.string().default(''),
  })).default([]).volatile(),
});

function currentValue(value) {
  return value && typeof value.get === 'function' ? value.get() : value;
}

/** One delegation policy: only the explicit opt-in widens the gate. */
function policyValue(config, key) {
  return currentValue(config[key]) === 'agent' ? 'agent' : 'ask';
}

/** Resolve one request's configuration snapshot from DSH volatile values. */
export function pluginSettings(config = {}, env = process.env) {
  const configuredBaseUrl = currentValue(config.apiBaseUrl);
  const configuredBasePath = currentValue(config.apiBasePath);
  const configuredEvidenceDirectory = currentValue(config.evidenceDirectory);
  const timeout = Number(currentValue(config.timeoutMs));
  const configuredProjects = currentValue(config.projects);
  const configuredRestrictTools = currentValue(config.restrictTools);
  return {
    baseUrl: typeof configuredBaseUrl === 'string' && configuredBaseUrl.trim() !== ''
      ? configuredBaseUrl.trim()
      : env.GEO_API_BASE_URL,
    // An explicit setting always wins over the environment, including over "set it
    // back to empty" — an empty basePath must be able to override GEO_API_BASE_PATH.
    basePath: typeof configuredBasePath === 'string' ? configuredBasePath.trim() : (env.GEO_API_BASE_PATH ?? ''),
    evidenceDirectory: typeof configuredEvidenceDirectory === 'string' && configuredEvidenceDirectory.trim() !== ''
      ? configuredEvidenceDirectory.trim()
      : env.GEO_EVIDENCE_DIRECTORY,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 && timeout <= 120_000
      ? timeout
      : defaultTimeout,
    restrictTools: configuredRestrictTools === undefined ? true : Boolean(configuredRestrictTools),
    // Anything other than the explicit opt-in value falls back to the safe
    // interactive default instead of failing startup or widening the gate.
    factConfirmPolicy: policyValue(config, 'factConfirmPolicy'),
    contentPrepPolicy: policyValue(config, 'contentPrepPolicy'),
    contentGenerationPolicy: policyValue(config, 'contentGenerationPolicy'),
    detectionPolicy: policyValue(config, 'detectionPolicy'),
    reportPolicy: policyValue(config, 'reportPolicy'),
    projects: Array.isArray(configuredProjects) ? configuredProjects.map(project => ({
      projectId: typeof project?.projectId === 'string' ? project.projectId.trim() : '',
      name: typeof project?.name === 'string' ? project.name.trim() : '',
    })) : [],
  };
}
