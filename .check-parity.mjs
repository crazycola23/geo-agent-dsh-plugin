import { readFileSync } from 'node:fs';

const catalog = JSON.parse(readFileSync('src/generated/openapi.catalog.json', 'utf8'));
const java = readFileSync(
  '../scrm-server/ruoyi-modules/ruoyi-geo/src/main/java/org/dromara/geo/contracts/GeoContractCodes.java',
  'utf8',
);

const catalogOps = Object.keys(catalog.operations);
console.log('catalog operations:', catalogOps.length);

// 服务端允许令牌访问的路由
const block = java.match(/PROJECT_API_TOKEN_ROUTES = List\.of\(([\s\S]*?)\n    \);/);
const javaRoutes = [...block[1].matchAll(/new ProjectApiTokenRoute\("(\w+)", "([^"]+)"/g)]
  .map(m => `${m[1]} ${m[2]}`);

console.log('java allowlisted routes:', javaRoutes.length);

const javaSet = new Set(javaRoutes);

// 目录里带 projectId 权限码的非 GET 操作（插件会暴露给 DSH 的写操作）
const writes = catalogOps.filter(name => catalog.operations[name].method !== 'GET');
console.log('catalog non-GET operations:', writes.length);

const missing = writes
  .map(name => catalog.operations[name])
  .filter(op => !javaSet.has(`${op.method.toUpperCase()} ${op.path}`))
  .map(op => `${op.method.toUpperCase()} ${op.path}`);

console.log('\n写操作中被服务端白名单拒绝的数量:', missing.length);
if (missing.length) console.log(missing.slice(0, 12).join('\n'));

// 反向：白名单里有但目录里没有的
const catalogSet = new Set(catalogOps.map(n => {
  const o = catalog.operations[n];
  return `${o.method.toUpperCase()} ${o.path}`;
}));
const orphan = javaRoutes.filter(r => !catalogSet.has(r));
console.log('\n服务端允许但目录未暴露:', orphan.length);
if (orphan.length) console.log(orphan.slice(0, 12).join('\n'));