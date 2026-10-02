export function normalizeProjectId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  const projectId = String(value).trim();
  return /^[1-9]\d{0,19}$/.test(projectId) ? projectId : undefined;
}

export function projectCredentialRefs(value) {
  const projectId = normalizeProjectId(value);
  if (!projectId) throw new TypeError('projectId must be a positive GEO project identifier');
  const prefix = `GEO_PROJECT_${projectId}`;
  return { apiToken: `${prefix}_API_TOKEN` };
}

export function resolveProjectSelection(selectedValue, requestArgs = {}) {
  const selectedProjectId = normalizeProjectId(selectedValue);
  if (!selectedProjectId) {
    return { ok: false, error: 'Select a valid GEO projectId to choose that project’s API token.' };
  }

  for (const [location, value] of [
    ['pathParams', requestArgs.pathParams?.projectId],
    ['query', requestArgs.query?.projectId],
    ['body', requestArgs.body?.projectId],
  ]) {
    if (value === undefined || value === null || value === '') continue;
    const requestProjectId = normalizeProjectId(value);
    if (!requestProjectId) {
      return { ok: false, error: `projectId in ${location} must be a positive GEO project identifier.` };
    }
    if (requestProjectId !== selectedProjectId) {
      return { ok: false, error: `Selected project ${selectedProjectId} does not match projectId in ${location} (${requestProjectId}).` };
    }
  }

  return { ok: true, projectId: selectedProjectId };
}
