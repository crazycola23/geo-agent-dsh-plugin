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

function matchesType(value, type) {
  if (Array.isArray(type)) return type.some(item => matchesType(value, item));
  switch (type) {
    case 'null': return value === null;
    case 'object': return isPlainObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    default: return true;
  }
}

function validateAt(value, rawSchema, path, schemas, issues, stack = new Set()) {
  if (!rawSchema || typeof rawSchema !== 'object') return;
  const schema = resolveSchema(rawSchema, schemas);
  if (!schema) {
    issues.push(`${path}: unresolved or recursive schema reference`);
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
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0 && !anyOfMatched) issues.push(`${path}: does not match any allowed shape`);
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const successes = schema.oneOf.filter(part => {
      const branchIssues = [];
      validateAt(value, part, path, schemas, branchIssues, nextStack);
      return branchIssues.length === 0;
    }).length;
    if (successes !== 1) issues.push(`${path}: must match exactly one allowed shape`);
  }
  if (schema.not) {
    const branchIssues = [];
    validateAt(value, schema.not, path, schemas, branchIssues, nextStack);
    if (branchIssues.length === 0) issues.push(`${path}: matches a forbidden shape`);
  }

  if (schema.type && !matchesType(value, schema.type)) {
    issues.push(`${path}: expected ${Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type}`);
    return;
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) issues.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some(item => Object.is(item, value))) {
    issues.push(`${path}: must be one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.format === 'uuid' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      issues.push(`${path}: must be a UUID`);
    }
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) issues.push(`${path}: must contain at least ${schema.minLength} characters`);
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) issues.push(`${path}: must contain at most ${schema.maxLength} characters`);
    if (schema.pattern) {
      try { if (!new RegExp(schema.pattern).test(value)) issues.push(`${path}: does not match the required pattern`); }
      catch { issues.push(`${path}: has an invalid schema pattern`); }
    }
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) issues.push(`${path}: must be at least ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) issues.push(`${path}: must be at most ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) issues.push(`${path}: must be greater than ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) issues.push(`${path}: must be less than ${schema.exclusiveMaximum}`);
    if (typeof schema.multipleOf === 'number' && schema.multipleOf !== 0 && value % schema.multipleOf !== 0) issues.push(`${path}: must be a multiple of ${schema.multipleOf}`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push(`${path}: must contain at least ${schema.minItems} items`);
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push(`${path}: must contain at most ${schema.maxItems} items`);
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) issues.push(`${path}: must not contain duplicate items`);
    if (schema.items) value.forEach((item, index) => validateAt(item, schema.items, `${path}[${index}]`, schemas, issues, nextStack));
  }
  if (isPlainObject(value)) {
    const properties = schema.properties || {};
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) issues.push(`${path}.${required}: is required`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (identityOverrideKey.test(key)) {
        issues.push(`${path}.${key}: identity and tenant fields come from the authenticated GEO account and cannot be supplied by the model`);
        continue;
      }
      if (Object.hasOwn(properties, key)) {
        validateAt(child, properties[key], `${path}.${key}`, schemas, issues, nextStack);
      } else if (schema.additionalProperties === false) {
        issues.push(`${path}.${key}: is not an allowed field`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateAt(child, schema.additionalProperties, `${path}.${key}`, schemas, issues, nextStack);
      }
    }
    if (Number.isInteger(schema.minProperties) && Object.keys(value).length < schema.minProperties) issues.push(`${path}: must contain at least ${schema.minProperties} fields`);
    if (Number.isInteger(schema.maxProperties) && Object.keys(value).length > schema.maxProperties) issues.push(`${path}: must contain at most ${schema.maxProperties} fields`);
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
    if (!isPlainObject(value)) errors.push(`${label}: must be an object`);
  }
  if (!isPlainObject(pathParams) || !isPlainObject(query) || !isPlainObject(headers)) return errors;

  const pathDefinitions = operation.parameters.filter(param => param.in === 'path');
  const queryDefinitions = operation.parameters.filter(param => param.in === 'query');
  const headerDefinitions = operation.parameters.filter(param => param.in === 'header');
  errors.push(...unknownKeys(pathParams, new Set(pathDefinitions.map(param => param.name)), 'pathParams'));
  errors.push(...unknownKeys(query, new Set(queryDefinitions.map(param => param.name)), 'query'));
  const allowedHeaderNames = new Set(headerDefinitions.map(param => param.name.toLowerCase()));
  errors.push(...Object.keys(headers).filter(key => !allowedHeaderNames.has(key.toLowerCase())).map(key => `headers.${key}: is not declared by the OpenAPI contract`));

  for (const param of [...pathDefinitions, ...queryDefinitions]) {
    const bucket = param.in === 'path' ? pathParams : query;
    if (!Object.hasOwn(bucket, param.name)) {
      if (param.required) errors.push(`${param.in === 'path' ? 'pathParams' : 'query'}.${param.name}: is required`);
      continue;
    }
    errors.push(...validateValue(bucket[param.name], param.schema, `${param.in === 'path' ? 'pathParams' : 'query'}.${param.name}`, catalog.schemas));
  }
  for (const param of headerDefinitions) {
    const key = Object.keys(headers).find(name => name.toLowerCase() === param.name.toLowerCase());
    if (key === undefined) {
      if (param.required || param.name.toLowerCase() === 'x-idempotency-key') errors.push(`headers.${param.name}: is required`);
      continue;
    }
    errors.push(...validateValue(headers[key], param.schema, `headers.${param.name}`, catalog.schemas));
    if (typeof headers[key] === 'string' && /[\r\n]/.test(headers[key])) errors.push(`headers.${param.name}: line breaks are not allowed`);
  }

  for (const key of Object.keys(headers)) {
    if (/^(?:authorization|cookie|host|connection|content-length|proxy-authorization)$/i.test(key)) {
      errors.push(`headers.${key}: this header is controlled by the GEO plugin`);
    }
  }

  const request = operation.requestBody;
  if (request?.required && args.body === undefined) errors.push('body: is required');
  if (args.body !== undefined) {
    if (!request?.schema) errors.push('body: this operation does not accept an application/json body');
    else errors.push(...validateValue(args.body, request.schema, 'body', catalog.schemas));
  }

  return errors;
}

function unknownKeys(value, allowed, label) {
  return Object.keys(value).filter(key => !allowed.has(key)).map(key => `${label}.${key}: is not declared by the OpenAPI contract`);
}

export function schemaSummary(rawSchema, schemas, depth = 0, visited = new Set()) {
  if (!rawSchema || typeof rawSchema !== 'object') return { type: 'unknown' };
  const schema = resolveSchema(rawSchema, schemas);
  if (!schema) return { type: 'unknown', note: 'cyclic or unresolved reference' };
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
