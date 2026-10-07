export function normalizeProjectId(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number' && !Number.isSafeInteger(value)) return undefined;
  const projectId = String(value).trim();
  return /^[1-9]\d{0,19}$/.test(projectId) ? projectId : undefined;
}

export function projectCredentialRefs(value) {
  const projectId = normalizeProjectId(value);
  if (!projectId) throw new TypeError('项目编号必须是有效的 GEO 项目编号：正整数');
  const prefix = `GEO_PROJECT_${projectId}`;
  return { apiToken: `${prefix}_API_TOKEN` };
}

/** 请求里可能携带项目编号的三个位置，报错时换成运营员看得懂的说法。 */
const LOCATION_LABEL = {
  pathParams: '地址里',
  query: '查询条件里',
  body: '请求内容里',
};

export function resolveProjectSelection(selectedValue, requestArgs = {}) {
  const selectedProjectId = normalizeProjectId(selectedValue);
  if (!selectedProjectId) {
    return { ok: false, error: '请先选中一个有效的项目编号，才能取用该项目的访问令牌。' };
  }

  for (const [location, value] of [
    ['pathParams', requestArgs.pathParams?.projectId],
    ['query', requestArgs.query?.projectId],
    ['body', requestArgs.body?.projectId],
  ]) {
    if (value === undefined || value === null || value === '') continue;
    const requestProjectId = normalizeProjectId(value);
    if (!requestProjectId) {
      return { ok: false, error: `请求${LOCATION_LABEL[location] ?? location}的项目编号必须是有效的 GEO 项目编号：正整数。` };
    }
    if (requestProjectId !== selectedProjectId) {
      return { ok: false, error: `选中的项目 ${selectedProjectId} 与请求${LOCATION_LABEL[location] ?? location}的项目编号（${requestProjectId}）不一致，已拦下这次调用以免串到别的项目。` };
    }
  }

  return { ok: true, projectId: selectedProjectId };
}