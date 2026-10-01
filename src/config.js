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
  evidenceDirectory: Schema.string().default(process.env.GEO_EVIDENCE_DIRECTORY ?? '').volatile(),
  timeoutMs: Schema.number().min(1_000).max(120_000).step(1_000).default(defaultTimeout).volatile(),
  projects: Schema.array(Schema.object({
    projectId: Schema.string(),
    name: Schema.string().default(''),
  })).default([]).volatile(),
});

function currentValue(value) {
  return value && typeof value.get === 'function' ? value.get() : value;
}

/** Resolve one request's configuration snapshot from DSH volatile values. */
export function pluginSettings(config = {}, env = process.env) {
  const configuredBaseUrl = currentValue(config.apiBaseUrl);
  const configuredEvidenceDirectory = currentValue(config.evidenceDirectory);
  const timeout = Number(currentValue(config.timeoutMs));
  const configuredProjects = currentValue(config.projects);
  return {
    baseUrl: typeof configuredBaseUrl === 'string' && configuredBaseUrl.trim() !== ''
      ? configuredBaseUrl.trim()
      : env.GEO_API_BASE_URL,
    evidenceDirectory: typeof configuredEvidenceDirectory === 'string' && configuredEvidenceDirectory.trim() !== ''
      ? configuredEvidenceDirectory.trim()
      : env.GEO_EVIDENCE_DIRECTORY,
    timeoutMs: Number.isFinite(timeout) && timeout >= 1_000 && timeout <= 120_000
      ? timeout
      : defaultTimeout,
    projects: Array.isArray(configuredProjects) ? configuredProjects.map(project => ({
      projectId: typeof project?.projectId === 'string' ? project.projectId.trim() : '',
      name: typeof project?.name === 'string' ? project.name.trim() : '',
    })) : [],
  };
}
