const identityOverrideKey = /^(?:tenant_?id|actor_?id|current_?user_?id|operator_?id|created_?by(?:_?id)?|trigger_?by(?:_?id)?)$/i;

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolveSchema(schema, schemas) {
  let current = schema;
  const seen = new Set();
  while (current?.$ref) {
    const name = current.$ref.split('/').at(-1).replaceAll('~1', '/').replaceAll('~0', '~');
    if (seen.has(name)) return null;
    seen.add(name);
    current = schemas[name];
    if (!current) return null;
  }
  return current;
}

// GEO 的雪花 ID 是 19 位，超出 JS 安全整数范围：JSON number 会静默丢精度（契约里对
// articleVersionId 等处有明文提示）。所以 integer/number 字段必须同时接受纯数字字符串，
// 否则 projectId 这类字段根本调不通——数字形式失真，字符串形式又被类型校验挡回。
const integerText = /^-?\d+$/;
const numericText = /^-?\d+(?:\.\d+)?$/;

function isIntegerText(value) {
  return typeof value === 'string' && integerText.test(value);
}

function isNumericText(value) {
  return typeof value === 'string' && numericText.test(value);
}

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some(item => matchesType(value, item));
  switch (type) {
    case 'null': return value === null;
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return (typeof value === 'number' && Number.isInteger(value)) || isIntegerText(value);
    case 'number': return (typeof value === 'number' && Number.isFinite(value)) || isNumericText(value);
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function validateAt(value, rawSchema, path, schemas, issues, stack = new Set()) {
  if (!rawSchema || typeof rawSchema !== 'object') return;
  const schema = resolveSchema(rawSchema, schemas);
  if (!schema) {
    issues.push(`${path}：引用的字段定义缺失或存在循环`);
    return;
  }
  if (schema.nullable && value === null) return;

  const visitKey = `${path}:${JSON.stringify(schema)}`;
  if (stack.has(visitKey)) return;
  const nextStack = new Set(stack).add(visitKey);

  for (const part of schema.allOf || []) validateAt(value, part, path, schemas, issues, nextStack);
  let anyOfMatched = false;
  for (const part of schema.anyOf || []) {
    const branchIssues = [];
    validateAt(value, part, path, schemas, branchIssues, nextStack);
    if (branchIssues.length === 0) anyOfMatched = true;
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0 && !anyOfMatched) issues.push(`${path}：不符合任何一种允许的写法`);
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const successes = schema.oneOf.filter(part => {
      const branchIssues = [];
      validateAt(value, part, path, schemas, branchIssues, nextStack);
      return branchIssues.length === 0;
    }).length;
    if (successes !== 1) issues.push(`${path}：必须恰好符合一种允许的写法`);
  }
  if (schema.not) {
    const branchIssues = [];
    validateAt(value, schema.not, path, schemas, branchIssues, nextStack);
    if (branchIssues.length === 0) issues.push(`${path}：命中了不允许的写法`);
  }

  if (schema.type && !matchesType(value, schema.type)) {
    issues.push(`${path}：应为 ${Array.isArray(schema.type) ? schema.type.join(' 或 ') : schema.type} 类型`);
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) issues.push(`${path}：必须等于 ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    issues.push(`${path}：只能是以下取值之一 ${schema.enum.map(item => JSON.stringify(item)).join('、')}`);
  }

  if (typeof value === 'string') {
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      issues.push(`${path}：必须是标准格式的唯一编号（UUID），例如 3f2a0c1e-9b41-4d7a-8e02-1c5b6a7d9e10`);
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) issues.push(`${path}：至少需要 ${schema.minLength} 个字符`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) issues.push(`${path}：最多只能有 ${schema.maxLength} 个字符`);
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) issues.push(`${path}：不符合要求的格式`); }
      catch { issues.push(`${path}：字段定义里的格式规则本身无效`); }
    }
  }
  // 数字与数字字符串统一按数值校验范围，避免放宽类型后绕过 minimum/maximum 检查。
  const numericValue = typeof value === 'number' ? value : (isNumericText(value) ? Number(value) : undefined);
  if (numericValue !== undefined) {
    if (typeof schema.minimum === 'number' && numericValue < schema.minimum) issues.push(`${path}：不能小于 ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && numericValue > schema.maximum) issues.push(`${path}：不能大于 ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && numericValue <= schema.exclusiveMinimum) issues.push(`${path}：必须大于 ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && numericValue >= schema.exclusiveMaximum) issues.push(`${path}：必须小于 ${schema.exclusiveMaximum}`);
    if (typeof schema.multipleOf === 'number' && schema.multipleOf !== 0 && numericValue % schema.multipleOf !== 0) issues.push(`${path}：必须是 ${schema.multipleOf} 的整数倍`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push(`${path}：至少需要 ${schema.minItems} 项`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push(`${path}：最多只能有 ${schema.maxItems} 项`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) issues.push(`${path}：里面不能有重复项`);
    if (schema.items) value.forEach((item, index) => validateAt(item, schema.items, `${path}[${index}]`, schemas, issues, nextStack));
  }
  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) issues.push(`${path}.${required}：是必填项，请补上`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (identityOverrideKey.test(key)) {
        issues.push(`${path}.${key}：身份与租户信息由已认证的 GEO 账号决定，不能由调用方自带`);
        continue;
      }
      if (Object.hasOwn(properties, key)) {
        validateAt(child, properties[key], `${path}.${key}`, schemas, issues, nextStack);
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}.${key}：不是这个接口允许的字段，请去掉`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateAt(child, schema.additionalProperties, `${path}.${key}`, schemas, issues, nextStack);
      }
    }
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) issues.push(`${path}：至少需要 ${schema.minProperties} 个字段`);
    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) issues.push(`${path}：最多只能有 ${schema.maxProperties} 个字段`);
  }
}

export function validateValue(value, schema, label, schemas) {
  const issues = [];
  validateAt(value, schema, label, schemas, issues);
  return issues;
}

export function validateOperationArgs(operation, args, catalog) {
  const errors = [];
  const pathParams = args.pathParams ?? {};
  const query = args.query ?? {};
  const headers = args.headers ?? {};

  for (const [label, value] of [['pathParams', pathParams], ['query', query], ['headers', headers]]) {
    if (!isPlainObject(value)) errors.push(`${label}（请求的${label === 'pathParams' ? '地址参数' : label === 'query' ? '查询条件' : '请求头'}部分）：必须是一个对象`);
  }
  if (!isPlainObject(pathParams) || !isPlainObject(query) || !isPlainObject(headers)) return errors;

  const pathDefinitions = operation.parameters.filter(param => param.in === 'path');
  const queryDefinitions = operation.parameters.filter(param => param.in === 'query');
  const headerDefinitions = operation.parameters.filter(param => param.in === 'header');
  errors.push(...unknownKeys(pathParams, new Set(pathDefinitions.map(param => param.name)), 'pathParams'));
  errors.push(...unknownKeys(query, new Set(queryDefinitions.map(param => param.name)), 'query'));
  const allowedHeaderNames = new Set(headerDefinitions.map(param => param.name.toLowerCase()));
  errors.push(...Object.keys(headers).filter(key => !allowedHeaderNames.has(key.toLowerCase())).map(key => `headers.${key}：这个请求头不在 GEO 接口的声明范围里，请去掉`));

  for (const param of [...pathDefinitions, ...queryDefinitions]) {
    const bucket = param.in === 'path' ? pathParams : query;
    if (!Object.hasOwn(bucket, param.name)) {
      if (param.required) errors.push(`${param.in === 'path' ? 'pathParams' : 'query'}.${param.name}：是必填项，请补上`);
      continue;
    }
    errors.push(...validateValue(bucket[param.name], param.schema, `${param.in === 'path' ? 'pathParams' : 'query'}.${param.name}`, catalog.schemas));
  }
  for (const param of headerDefinitions) {
    const key = Object.keys(headers).find(name => name.toLowerCase() === param.name.toLowerCase());
    if (key === undefined) {
      if (param.required || param.name.toLowerCase() === 'x-idempotency-key') errors.push(`headers.${param.name}：是必填项，请补上`);
      continue;
    }
    errors.push(...validateValue(headers[key], param.schema, `headers.${param.name}`, catalog.schemas));
    if (typeof headers[key] === 'string' && /[\r\n]/.test(headers[key])) errors.push(`headers.${param.name}：不允许包含换行`);
  }

  for (const key of Object.keys(headers)) {
    if (/^(?:authorization|cookie|host|connection|content-length|proxy-authorization)$/i.test(key)) {
      errors.push(`headers.${key}：这个请求头由 GEO 插件自己填写，调用方不能指定`);
    }
  }

  const request = operation.requestBody;
  if (request?.required && args.body === undefined) errors.push('body（请求内容）：是必填项，请补上');
  if (args.body !== undefined) {
    if (!request?.schema) errors.push('body（请求内容）：这个操作不接受 JSON 格式的请求内容');
    else errors.push(...validateValue(args.body, request.schema, 'body', catalog.schemas));
  }

  return errors;
}

function unknownKeys(value, allowed, label) {
  return Object.keys(value).filter(key => !allowed.has(key)).map(key => `${label}.${key}：不在 GEO 接口的声明范围里，请去掉`);
}

export function schemaSummary(rawSchema, schemas, depth = 0, visited = new Set()) {
  if (!rawSchema || typeof rawSchema !== 'object') return { type: 'unknown' };
  const schema = resolveSchema(rawSchema, schemas);
  if (!schema) return { type: 'unknown', note: '字段定义存在循环或缺失' };
  if (depth >= 5) return { type: schema.type || 'object', truncated: true };
  const marker = JSON.stringify(schema);
  if (visited.has(marker)) return { type: schema.type || 'object', recursive: true };
  const nextVisited = new Set(visited).add(marker);
  const result = { type: schema.type || (schema.properties ? 'object' : 'unknown') };
  if (schema.description) result.description = schema.description;
  if (schema.enum) result.allowedValues = schema.enum;
  if (schema.format) result.format = schema.format;
  if (schema.nullable) result.nullable = true;
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems', 'pattern']) {
    if (schema[key] !== undefined) result[key] = schema[key];
  }
  if (schema.required?.length) result.required = schema.required;
  if (schema.type === 'object' || schema.properties) {
    result.properties = Object.fromEntries(Object.entries(schema.properties || {}).map(([key, value]) => [key, schemaSummary(value, schemas, depth + 1, nextVisited)]));
    if (schema.additionalProperties === false) result.additionalProperties = false;
  }
  if (schema.type === 'array' && schema.items) result.items = schemaSummary(schema.items, schemas, depth + 1, nextVisited);
  if (schema.oneOf) result.oneOf = schema.oneOf.map(item => schemaSummary(item, schemas, depth + 1, nextVisited));
  if (schema.allOf) result.allOf = schema.allOf.map(item => schemaSummary(item, schemas, depth + 1, nextVisited));
  return result;
}