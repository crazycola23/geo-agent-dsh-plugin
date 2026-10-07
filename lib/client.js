window.__ModuleLoader__.load({ id: "@geo-internal/geo-agent-dsh-plugin", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
//#region rolldown:runtime
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));

//#endregion
let react = require("react");
react = __toESM(react);
let react_jsx_runtime = require("react/jsx-runtime");
react_jsx_runtime = __toESM(react_jsx_runtime);

//#region src/project-context.js
function normalizeProjectId(value) {
	if (typeof value !== "string" && typeof value !== "number") return void 0;
	if (typeof value === "number" && !Number.isSafeInteger(value)) return void 0;
	const projectId = String(value).trim();
	return /^[1-9]\d{0,19}$/.test(projectId) ? projectId : void 0;
}
function projectCredentialRefs(value) {
	const projectId = normalizeProjectId(value);
	if (!projectId) throw new TypeError("projectId must be a positive GEO project identifier");
	return { apiToken: `${`GEO_PROJECT_${projectId}`}_API_TOKEN` };
}

//#endregion
//#region \0geo-dsh-css:D:\wt\geo-agent-full-flow\geo-agent-dsh-plugin\src\client\geo-settings.module.css.mjs
const css$1 = ".HQDdta_card{color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:12px}.HQDdta_header{width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:12px;padding:14px 16px;display:flex}.HQDdta_header:focus-visible,.HQDdta_input:focus-visible,.HQDdta_primaryButton:focus-visible,.HQDdta_ghostButton:focus-visible,.HQDdta_clearButton:focus-visible,.HQDdta_dangerButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:2px}.HQDdta_title{font-size:15px;font-weight:600;line-height:1.4}.HQDdta_hint{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:1.5}.HQDdta_badge,.HQDdta_credentialState{color:var(--dsw-alias-label-secondary,#4b5563);white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:999px;align-items:center;gap:6px;padding:3px 8px;font-size:11px;display:inline-flex}.HQDdta_badgeReady,.HQDdta_credentialStateReady{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:var(--dsw-alias-state-success-primary,#1a7f37)}.HQDdta_stateDot{background:var(--dsw-alias-state-warning-primary,#9a6700);border-radius:50%;width:6px;height:6px}.HQDdta_badgeReady .HQDdta_stateDot,.HQDdta_credentialStateReady .HQDdta_stateDot{background:var(--dsw-alias-state-success-primary,#1a7f37)}.HQDdta_chevron{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:18px;line-height:1;transition:transform .15s}.HQDdta_chevronOpen{transform:rotate(180deg)}.HQDdta_body{flex-direction:column;gap:16px;padding:0 16px 14px;display:flex}.HQDdta_section{flex-direction:column;gap:12px;display:flex}.HQDdta_sectionHeading{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;display:flex}.HQDdta_sectionTitle{color:var(--dsw-alias-label-primary,#1f2329);margin:0;font-size:13px;font-weight:600}.HQDdta_emptyProjects{color:var(--dsw-alias-label-tertiary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px dashed var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;padding:14px;font-size:12px;line-height:1.5}.HQDdta_projectCard{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;flex-direction:column;gap:12px;padding:12px;display:flex}.HQDdta_projectHeader{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:9px;display:flex}.HQDdta_projectTitleGroup{align-items:center;gap:9px;min-width:0;display:flex}.HQDdta_projectIcon{width:26px;height:26px;color:var(--dsw-alias-state-business-primary,#4f8cff);background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4f8cff) 12%, transparent);border-radius:7px;flex:0 0 26px;place-items:center;font-size:11px;font-weight:700;display:grid}.HQDdta_projectTitleGroup>div{flex-direction:column;gap:2px;min-width:0;display:flex}.HQDdta_projectTitle{color:var(--dsw-alias-label-primary,#1f2329);text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.HQDdta_credentialStates{flex-wrap:wrap;gap:6px;display:flex}.HQDdta_field{flex-direction:column;flex:1 1 0;gap:5px;min-width:0;display:flex}.HQDdta_label{color:var(--dsw-alias-label-primary,#1f2329);font-size:12px;font-weight:500}.HQDdta_input{box-sizing:border-box;width:100%;min-height:34px;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);font:inherit;border-radius:6px;padding:7px 9px;font-size:12px}.HQDdta_input:disabled{opacity:.65;cursor:not-allowed}.HQDdta_twoColumns{gap:12px;display:flex}.HQDdta_inlineError,.HQDdta_failure{color:var(--dsw-alias-state-error-primary,#d1242f);margin:0;font-size:12px;line-height:1.45}.HQDdta_confirmRow{color:var(--dsw-alias-label-secondary,#4b5563);flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;display:flex}.HQDdta_footer{flex-wrap:wrap;align-items:center;gap:9px;padding-top:2px;display:flex}.HQDdta_primaryButton,.HQDdta_ghostButton,.HQDdta_dangerButton,.HQDdta_clearButton{cursor:pointer;font:inherit;border-radius:6px;padding:7px 12px;font-size:12px}.HQDdta_primaryButton{color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#4f8cff);border:1px solid #0000;font-weight:500}.HQDdta_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3b76e0)}.HQDdta_primaryButton:disabled,.HQDdta_ghostButton:disabled,.HQDdta_dangerButton:disabled,.HQDdta_clearButton:disabled{opacity:.55;cursor:not-allowed}.HQDdta_ghostButton{color:var(--dsw-alias-label-secondary,#4b5563);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de)}.HQDdta_clearButton{color:var(--dsw-alias-label-tertiary,#6b7280);text-underline-offset:2px;background:0 0;border:0;align-self:flex-start;padding:2px 0;text-decoration:underline}.HQDdta_dangerButton{color:var(--dsw-alias-state-error-primary,#d1242f);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-state-error-primary,#d1242f)}.HQDdta_success{color:var(--dsw-alias-state-success-primary,#1a7f37);font-size:11px;line-height:1.4}@media (width<=620px){.HQDdta_header{gap:8px;padding:12px}.HQDdta_body{padding:0 12px 12px}.HQDdta_twoColumns{flex-direction:column}.HQDdta_projectHeader{flex-direction:column;align-items:flex-start}}.HQDdta_switch{cursor:pointer;user-select:none;flex:none;align-items:center;gap:8px;display:inline-flex}.HQDdta_switchInput{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.HQDdta_switchTrack{border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-1,#e5e7eb);border-radius:9px;flex:none;width:34px;height:18px;transition:background-color .15s,border-color .15s;display:inline-block;position:relative}.HQDdta_switchTrackOn{border-color:var(--dsw-alias-state-warning-primary,#d97706);background:var(--dsw-alias-state-warning-primary,#d97706)}.HQDdta_switchThumb{background:#fff;border-radius:50%;width:14px;height:14px;transition:transform .15s;position:absolute;top:1px;left:1px}.HQDdta_switchTrackOn .HQDdta_switchThumb{transform:translate(16px)}.HQDdta_switchInput:focus-visible+.HQDdta_switchTrack{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:1px}.HQDdta_switchInput:disabled+.HQDdta_switchTrack{cursor:not-allowed;opacity:.5}.HQDdta_switchLabel{color:var(--dsw-alias-label-secondary,#4b5563);white-space:nowrap;font-size:11px}.HQDdta_tabs{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;gap:4px;padding:3px;display:flex}.HQDdta_tab{color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:1;padding:6px 10px;font-size:12px;font-weight:600}.HQDdta_tabActive{color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px #00000014}.HQDdta_policyRow{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;display:flex}.HQDdta_policyMeta{flex-direction:column;gap:2px;min-width:0;display:flex}.HQDdta_policyName{color:var(--dsw-alias-label-primary,#1f2329);font-size:12px;font-weight:600}.HQDdta_policyScope{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px;line-height:1.4}.HQDdta_segmented{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;flex:none;gap:2px;padding:2px;display:inline-flex}.HQDdta_segmentButton{color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;background:0 0;border:none;border-radius:4px;padding:3px 12px;font-size:11px;font-weight:600}.HQDdta_segmentButtonActive{color:#fff;background:var(--dsw-alias-state-business-primary,#4f8cff)}.HQDdta_segmentButton:disabled{cursor:not-allowed;opacity:.5}.HQDdta_segmentButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:1px}";
const tagId$1 = "@geo-internal/geo-agent-dsh-plugin/geo-settings.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@geo-internal/geo-agent-dsh-plugin";
	tag.dataset.pluginCss = tagId$1;
	tag.textContent = css$1;
	document.head.appendChild(tag);
}
var geo_settings_module_css_default = {
	"label": "HQDdta_label",
	"switchThumb": "HQDdta_switchThumb",
	"policyRow": "HQDdta_policyRow",
	"ghostButton": "HQDdta_ghostButton",
	"stateDot": "HQDdta_stateDot",
	"card": "HQDdta_card",
	"badgeReady": "HQDdta_badgeReady",
	"projectTitle": "HQDdta_projectTitle",
	"title": "HQDdta_title",
	"dangerButton": "HQDdta_dangerButton",
	"sectionHeading": "HQDdta_sectionHeading",
	"projectCard": "HQDdta_projectCard",
	"field": "HQDdta_field",
	"inlineError": "HQDdta_inlineError",
	"emptyProjects": "HQDdta_emptyProjects",
	"footer": "HQDdta_footer",
	"success": "HQDdta_success",
	"switchTrackOn": "HQDdta_switchTrackOn",
	"credentialState": "HQDdta_credentialState",
	"header": "HQDdta_header",
	"confirmRow": "HQDdta_confirmRow",
	"credentialStateReady": "HQDdta_credentialStateReady",
	"switchLabel": "HQDdta_switchLabel",
	"segmented": "HQDdta_segmented",
	"switchTrack": "HQDdta_switchTrack",
	"chevron": "HQDdta_chevron",
	"section": "HQDdta_section",
	"projectIcon": "HQDdta_projectIcon",
	"credentialStates": "HQDdta_credentialStates",
	"switch": "HQDdta_switch",
	"body": "HQDdta_body",
	"tab": "HQDdta_tab",
	"policyScope": "HQDdta_policyScope",
	"policyName": "HQDdta_policyName",
	"badge": "HQDdta_badge",
	"clearButton": "HQDdta_clearButton",
	"twoColumns": "HQDdta_twoColumns",
	"input": "HQDdta_input",
	"segmentButton": "HQDdta_segmentButton",
	"policyMeta": "HQDdta_policyMeta",
	"tabs": "HQDdta_tabs",
	"segmentButtonActive": "HQDdta_segmentButtonActive",
	"chevronOpen": "HQDdta_chevronOpen",
	"sectionTitle": "HQDdta_sectionTitle",
	"projectHeader": "HQDdta_projectHeader",
	"failure": "HQDdta_failure",
	"primaryButton": "HQDdta_primaryButton",
	"hint": "HQDdta_hint",
	"projectTitleGroup": "HQDdta_projectTitleGroup",
	"switchInput": "HQDdta_switchInput",
	"tabActive": "HQDdta_tabActive"
};

//#endregion
//#region src/client/GeoSettingsCard.tsx
function normalizeBasePathInput(input) {
	const value = input.trim();
	if (value === "" || value === "/") return "";
	if (!value.startsWith("/")) throw new Error("网关路径前缀要以 / 开头，例如 /prod-api。");
	if (value.includes("//") || value.includes("\\") || value.includes("?") || value.includes("#")) throw new Error("网关路径前缀只能是一段路径，不要带查询参数、片段或反斜杠。");
	return value.replace(/\/+$/, "");
}
function normalizeOrigin(input) {
	const value = input.trim();
	if (!value) throw new Error("请填写 GEO 服务地址。");
	const url = new URL(value.includes("://") ? value : `https://${value}`);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("请填写服务协议、IP/域名和端口，不要填写路径、用户名或查询参数。");
	if (url.protocol !== "https:" && ![
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(url.hostname)) throw new Error("GEO 项目令牌要求 HTTPS；内网 IP 也需要配置 HTTPS。");
	return url.origin;
}
/** 仅做布尔化：合法项目 ID（正整数）与运行时同一套正则来源。 */
function validProjectId(value) {
	return normalizeProjectId(value) !== void 0;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : "保存失败，请检查 DSH 配置服务。";
}
function draftsFrom(projects) {
	return (projects ?? []).map((project, index) => ({
		draftKey: `saved-${project.projectId}-${index}`,
		projectId: project.projectId,
		name: project.name ?? "",
		apiToken: "",
		persisted: true
	}));
}
const POLICY_DOMAINS = [
	{
		key: "factConfirmPolicy",
		name: "事实确认",
		scope: "事实修订与提取候选的确认、停用、存疑"
	},
	{
		key: "contentPrepPolicy",
		name: "内容准备",
		scope: "问题、问题面板、内容要素、事实提取发起"
	},
	{
		key: "contentGenerationPolicy",
		name: "内容生成",
		scope: "生成任务与文章卡片，会产生模型调用费用"
	},
	{
		key: "detectionPolicy",
		name: "检测",
		scope: "检测计划、运行与重试；预算仍由服务端硬校验"
	},
	{
		key: "reportPolicy",
		name: "报告",
		scope: "报告生成、确认、渲染与按规则恢复"
	}
];
function Field(props) {
	const { label, hint, value, onChange, placeholder, type = "text", min, max, autoComplete, disabled, testId } = props;
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
		className: geo_settings_module_css_default.field,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: geo_settings_module_css_default.label,
				children: label
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				className: geo_settings_module_css_default.input,
				type,
				value,
				placeholder,
				min,
				max,
				autoComplete,
				disabled,
				"data-testid": testId,
				onChange: (event) => onChange(event.target.value)
			}),
			hint ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: geo_settings_module_css_default.hint,
				children: hint
			}) : null
		]
	});
}
async function describeCredentials(credentials, refs) {
	if (refs.length === 0) return {};
	const result = await credentials.describe(refs);
	if (!result.ok) throw new Error(result.error?.message || "无法读取 DSH 凭据状态。");
	return result.value;
}
async function writeCredential(credentials, ref, value) {
	const result = await credentials.set(ref, value);
	if (!result.ok) throw new Error(result.error?.message || "DSH 拒绝保存项目令牌。");
}
async function removeCredential(credentials, ref) {
	const result = await credentials.unset(ref);
	if (!result.ok) throw new Error(result.error?.message || "DSH 拒绝删除项目令牌。");
}
function CredentialState(props) {
	const configured = props.info?.configured === true;
	const label = configured ? props.info?.writable === false ? "已配置 · 由外部管理" : "已安全保存" : "未配置";
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
		className: `${geo_settings_module_css_default.credentialState} ${configured ? geo_settings_module_css_default.credentialStateReady : ""}`,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.stateDot }),
			props.label,
			"：",
			label
		]
	});
}
function GeoSettingsCard(props) {
	const { scope, useSnapshot, t, credentials } = props;
	const snapshot = useSnapshot();
	const value = snapshot.value ?? {};
	const [expanded, setExpanded] = (0, react.useState)(true);
	const [apiBaseUrl, setApiBaseUrl] = (0, react.useState)(value.apiBaseUrl ?? "");
	const [apiBasePath, setApiBasePath] = (0, react.useState)(value.apiBasePath ?? "");
	const [evidenceDirectory, setEvidenceDirectory] = (0, react.useState)(value.evidenceDirectory ?? "");
	const [timeoutSeconds, setTimeoutSeconds] = (0, react.useState)(String(Math.round((value.timeoutMs ?? 3e4) / 1e3)));
	const [projects, setProjects] = (0, react.useState)(() => draftsFrom(value.projects));
	const [credentialState, setCredentialState] = (0, react.useState)({});
	const [credentialError, setCredentialError] = (0, react.useState)();
	const [busy, setBusy] = (0, react.useState)(false);
	const [dirty, setDirty] = (0, react.useState)(false);
	const [saved, setSaved] = (0, react.useState)(false);
	const [failure, setFailure] = (0, react.useState)();
	const [removedProjectIds, setRemovedProjectIds] = (0, react.useState)([]);
	const [confirmRemoveKey, setConfirmRemoveKey] = (0, react.useState)();
	const [isolationBusy, setIsolationBusy] = (0, react.useState)(false);
	const [isolationError, setIsolationError] = (0, react.useState)();
	const [tab, setTab] = (0, react.useState)("connection");
	const [policyBusyKey, setPolicyBusyKey] = (0, react.useState)();
	const [policyError, setPolicyError] = (0, react.useState)();
	const nextDraftId = (0, react.useRef)(0);
	(0, react.useEffect)(() => {
		if (dirty) return;
		setApiBaseUrl(value.apiBaseUrl ?? "");
		setApiBasePath(value.apiBasePath ?? "");
		setEvidenceDirectory(value.evidenceDirectory ?? "");
		setTimeoutSeconds(String(Math.round((value.timeoutMs ?? 3e4) / 1e3)));
		setProjects(draftsFrom(value.projects));
	}, [
		dirty,
		value.apiBaseUrl,
		value.apiBasePath,
		value.evidenceDirectory,
		value.timeoutMs,
		value.projects
	]);
	const refsInUse = projects.flatMap((project) => validProjectId(project.projectId) ? Object.values(projectCredentialRefs(project.projectId.trim())) : []);
	const refsKey = [...new Set(refsInUse)].sort().join("|");
	(0, react.useEffect)(() => {
		if (!credentials) {
			setCredentialError("当前 DSH 没有提供凭据设置接口。");
			return;
		}
		const refs = refsKey ? refsKey.split("|") : [];
		if (refs.length === 0) {
			setCredentialState({});
			setCredentialError(void 0);
			return;
		}
		let stale = false;
		describeCredentials(credentials, refs).then((state) => {
			if (!stale) {
				setCredentialState((current) => ({
					...current,
					...state
				}));
				setCredentialError(void 0);
			}
		}).catch((error) => {
			if (!stale) setCredentialError(errorMessage(error));
		});
		return () => {
			stale = true;
		};
	}, [credentials, refsKey]);
	const configuredProjectCount = projects.filter((project) => {
		if (!validProjectId(project.projectId)) return false;
		return credentialState[projectCredentialRefs(project.projectId.trim()).apiToken]?.configured === true;
	}).length;
	const endpointReady = apiBaseUrl.trim().length > 0;
	const statusCopy = endpointReady && configuredProjectCount > 0 ? `待验证 · ${configuredProjectCount} 个项目` : "待配置";
	const markDirty = () => {
		setDirty(true);
		setSaved(false);
		setFailure(void 0);
	};
	const updateProject = (draftKey, field, nextValue) => {
		markDirty();
		setProjects((current) => current.map((project) => project.draftKey === draftKey ? {
			...project,
			[field]: nextValue
		} : project));
	};
	const addProject = () => {
		nextDraftId.current += 1;
		markDirty();
		setProjects((current) => [...current, {
			draftKey: `new-${nextDraftId.current}`,
			projectId: "",
			name: "",
			apiToken: "",
			persisted: false
		}]);
	};
	const confirmRemoveProject = (project) => {
		const projectId = project.projectId.trim();
		if (project.persisted && validProjectId(projectId)) setRemovedProjectIds((current) => current.includes(projectId) ? current : [...current, projectId]);
		markDirty();
		setProjects((current) => current.filter((item) => item.draftKey !== project.draftKey));
		setConfirmRemoveKey(void 0);
	};
	const save = async () => {
		if (!credentials) {
			setFailure("当前 DSH 没有提供凭据设置接口，无法安全保存项目令牌。");
			return;
		}
		let origin;
		let gatewayPrefix;
		try {
			origin = normalizeOrigin(apiBaseUrl);
			gatewayPrefix = normalizeBasePathInput(apiBasePath);
		} catch (error) {
			setFailure(errorMessage(error));
			return;
		}
		const seconds = Number(timeoutSeconds);
		if (!Number.isInteger(seconds) || seconds < 1 || seconds > 120) {
			setFailure("请求超时需为 1–120 秒的整数。");
			return;
		}
		const normalizedProjects = [];
		const seenProjectIds = /* @__PURE__ */ new Set();
		const credentialWrites = [];
		for (const project of projects) {
			const projectId = project.projectId.trim();
			if (!validProjectId(projectId)) {
				setFailure("每个项目都要填写有效的 GEO 项目 ID（正整数）。");
				return;
			}
			if (seenProjectIds.has(projectId)) {
				setFailure(`项目 ID ${projectId} 重复了；每个项目只能配置一个令牌。`);
				return;
			}
			seenProjectIds.add(projectId);
			if (project.name.trim().length > 80) {
				setFailure(`项目 ${projectId} 的名称不能超过 80 个字符。`);
				return;
			}
			const refs = projectCredentialRefs(projectId);
			const apiToken = project.apiToken.trim();
			const tokenConfigured = credentialState[refs.apiToken]?.configured === true;
			if (!apiToken && !tokenConfigured) {
				setFailure(`请粘贴为项目 ${projectId} 创建的项目 API 令牌。`);
				return;
			}
			if (apiToken && credentialState[refs.apiToken]?.writable === false) {
				setFailure(`项目 ${projectId} 的令牌由外部管理，无法在此覆盖。`);
				return;
			}
			if (apiToken) credentialWrites.push({
				ref: refs.apiToken,
				value: apiToken
			});
			normalizedProjects.push({
				projectId,
				name: project.name.trim()
			});
		}
		setBusy(true);
		setFailure(void 0);
		let credentialWriteAttempted = false;
		let credentialWritesComplete = false;
		let projectSettingsSaved = false;
		try {
			for (const item of credentialWrites) {
				credentialWriteAttempted = true;
				await writeCredential(credentials, item.ref, item.value);
			}
			credentialWritesComplete = true;
			await scope.set("apiBaseUrl", origin);
			await scope.set("apiBasePath", gatewayPrefix);
			await scope.set("evidenceDirectory", evidenceDirectory.trim());
			await scope.set("timeoutMs", seconds * 1e3);
			await scope.set("projects", normalizedProjects);
			projectSettingsSaved = true;
			const savedIds = new Set(normalizedProjects.map((project) => project.projectId));
			const idsToClear = removedProjectIds.filter((projectId) => !savedIds.has(projectId));
			for (const projectId of idsToClear) {
				const refs = projectCredentialRefs(projectId);
				for (const ref of Object.values(refs)) {
					if (credentialState[ref]?.writable === false) continue;
					await removeCredential(credentials, ref);
				}
			}
			setCredentialState(await describeCredentials(credentials, normalizedProjects.flatMap((project) => Object.values(projectCredentialRefs(project.projectId)))));
			setCredentialError(void 0);
			setProjects(normalizedProjects.map((project, index) => ({
				...project,
				draftKey: `saved-${project.projectId}-${index}`,
				apiToken: "",
				persisted: true
			})));
			setEvidenceDirectory(evidenceDirectory.trim());
			setApiBaseUrl(origin);
			setApiBasePath(gatewayPrefix);
			setRemovedProjectIds([]);
			setDirty(false);
			setSaved(true);
		} catch (error) {
			const message = errorMessage(error);
			const refs = projects.flatMap((project) => validProjectId(project.projectId) ? Object.values(projectCredentialRefs(project.projectId.trim())) : []);
			if (credentialWriteAttempted || projectSettingsSaved) try {
				const refreshedState = await describeCredentials(credentials, refs);
				setCredentialState((current) => ({
					...current,
					...refreshedState
				}));
				setCredentialError(void 0);
			} catch {
				setCredentialError("配置写入后无法读取最新凭据状态；请重新打开设置卡核对。");
			}
			if (projectSettingsSaved) setFailure(`项目设置已保存，但旧凭据清理未完成：${message}`);
			else if (credentialWritesComplete && credentialWriteAttempted) setFailure(`项目凭据已保存，但普通设置未全部保存：${message}`);
			else if (credentialWriteAttempted) setFailure(`凭据写入结果可能不完整，请核对项目状态后再试：${message}`);
			else setFailure(message);
		} finally {
			setBusy(false);
		}
	};
	const restrictTools = value.restrictTools !== false;
	const setRestriction = async (next) => {
		setIsolationBusy(true);
		setIsolationError(void 0);
		try {
			await scope.set("restrictTools", next);
		} catch (error) {
			setIsolationError(errorMessage(error));
		} finally {
			setIsolationBusy(false);
		}
	};
	const policyValue = (key) => value[key] === "agent" ? "agent" : "ask";
	const setPolicy = async (key, next) => {
		setPolicyBusyKey(key);
		setPolicyError(void 0);
		try {
			await scope.set(key, next);
		} catch (error) {
			setPolicyError(errorMessage(error));
		} finally {
			setPolicyBusyKey(void 0);
		}
	};
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
		className: geo_settings_module_css_default.card,
		"data-testid": "geo-workbench-card",
		children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
			className: geo_settings_module_css_default.header,
			type: "button",
			"aria-expanded": expanded,
			onClick: () => setExpanded((current) => !current),
			children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: geo_settings_module_css_default.title,
					children: t("title")
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: `${geo_settings_module_css_default.badge} ${endpointReady && configuredProjectCount > 0 ? geo_settings_module_css_default.badgeReady : ""}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.stateDot }), statusCopy]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: `${geo_settings_module_css_default.chevron} ${expanded ? geo_settings_module_css_default.chevronOpen : ""}`,
					"aria-hidden": "true",
					children: "⌄"
				})
			]
		}), expanded ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
			className: geo_settings_module_css_default.body,
			children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_settings_module_css_default.tabs,
				role: "tablist",
				"data-testid": "geo-settings-tabs",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: tab === "connection" ? `${geo_settings_module_css_default.tab} ${geo_settings_module_css_default.tabActive}` : geo_settings_module_css_default.tab,
					type: "button",
					role: "tab",
					"aria-selected": tab === "connection",
					"data-testid": "geo-tab-connection",
					onClick: () => setTab("connection"),
					children: "连接"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					className: tab === "runtime" ? `${geo_settings_module_css_default.tab} ${geo_settings_module_css_default.tabActive}` : geo_settings_module_css_default.tab,
					type: "button",
					role: "tab",
					"aria-selected": tab === "runtime",
					"data-testid": "geo-tab-runtime",
					onClick: () => setTab("runtime"),
					children: "运行"
				})]
			}), tab === "connection" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_settings_module_css_default.section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: geo_settings_module_css_default.sectionTitle,
							children: "GEO 服务"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: "GEO 服务 IP / 域名",
							hint: "仅协议、主机和端口",
							value: apiBaseUrl,
							placeholder: "https://192.168.2.110:端口",
							testId: "geo-api-base-url",
							disabled: busy || !snapshot.writable,
							onChange: (next) => {
								markDirty();
								setApiBaseUrl(next);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
							label: "资料投递目录",
							hint: "仅该目录下的文档可上传。",
							value: evidenceDirectory,
							placeholder: "D:\\\\geo-evidence",
							testId: "geo-evidence-directory",
							disabled: busy || !snapshot.writable,
							onChange: (next) => {
								markDirty();
								setEvidenceDirectory(next);
							}
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: geo_settings_module_css_default.twoColumns,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: "转发路径前缀",
								hint: "经网关转发时填写；直连留空",
								value: apiBasePath,
								placeholder: "/prod-api",
								testId: "geo-api-base-path",
								disabled: busy || !snapshot.writable,
								onChange: (next) => {
									markDirty();
									setApiBasePath(next);
								}
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: "请求超时（秒）",
								type: "number",
								min: 1,
								max: 120,
								value: timeoutSeconds,
								testId: "geo-timeout-seconds",
								disabled: busy || !snapshot.writable,
								onChange: (next) => {
									markDirty();
									setTimeoutSeconds(next);
								}
							})]
						})
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_settings_module_css_default.section,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: geo_settings_module_css_default.sectionHeading,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: geo_settings_module_css_default.sectionTitle,
								children: "项目授权"
							}) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								className: geo_settings_module_css_default.ghostButton,
								type: "button",
								disabled: busy || !snapshot.writable,
								onClick: addProject,
								children: "＋ 添加项目"
							})]
						}),
						projects.length === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: geo_settings_module_css_default.emptyProjects,
							children: "添加项目编号与该项目的访问令牌。"
						}) : projects.map((project, index) => {
							const projectId = project.projectId.trim();
							const refs = validProjectId(projectId) ? projectCredentialRefs(projectId) : void 0;
							const tokenInfo = refs ? credentialState[refs.apiToken] : void 0;
							const externalManaged = tokenInfo?.writable === false;
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.projectCard,
								"data-testid": `geo-project-row-${index}`,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: geo_settings_module_css_default.projectHeader,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: geo_settings_module_css_default.projectTitleGroup,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: geo_settings_module_css_default.projectIcon,
												children: index + 1
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
												className: geo_settings_module_css_default.projectTitle,
												children: project.name.trim() || (projectId ? `项目 ${projectId}` : "新项目授权")
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: geo_settings_module_css_default.credentialStates,
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(CredentialState, {
												label: "项目访问令牌",
												info: tokenInfo
											})
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: geo_settings_module_css_default.twoColumns,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "项目编号",
											hint: "调用工具时使用同一个项目编号。",
											value: project.projectId,
											placeholder: "例如 2100100790457094145",
											testId: `geo-project-id-${index}`,
											disabled: busy || !snapshot.writable || project.persisted,
											onChange: (next) => updateProject(project.draftKey, "projectId", next)
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
											label: "项目名称",
											value: project.name ?? "",
											placeholder: "例如 品牌 A 官网增长",
											testId: `geo-project-name-${index}`,
											disabled: busy || !snapshot.writable,
											onChange: (next) => updateProject(project.draftKey, "name", next)
										})]
									}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
										label: "该项目访问令牌",
										hint: "写入后不再回显；轮换时先在 GEO 撤销旧令牌，再粘贴新令牌。",
										value: project.apiToken,
										type: "password",
										placeholder: tokenInfo?.configured ? "已安全保存；留空表示不更改" : "粘贴该项目的访问令牌",
										testId: `geo-project-api-token-${index}`,
										autoComplete: "new-password",
										disabled: busy || tokenInfo?.writable === false,
										onChange: (next) => updateProject(project.draftKey, "apiToken", next)
									}),
									confirmRemoveKey === project.draftKey ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: geo_settings_module_css_default.confirmRow,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "移除该项目后，保存时会一并清理已保存的访问令牌。继续吗？" }),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: geo_settings_module_css_default.dangerButton,
												type: "button",
												disabled: busy,
												onClick: () => confirmRemoveProject(project),
												children: "确认移除"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												className: geo_settings_module_css_default.ghostButton,
												type: "button",
												disabled: busy,
												onClick: () => setConfirmRemoveKey(void 0),
												children: "取消"
											})
										]
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: geo_settings_module_css_default.clearButton,
										type: "button",
										disabled: busy,
										onClick: () => setConfirmRemoveKey(project.draftKey),
										children: "移除项目"
									}),
									externalManaged ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
										className: geo_settings_module_css_default.hint,
										children: "外部管理的凭据需在其来源处轮换或清理。"
									}) : null
								]
							}, project.draftKey);
						}),
						credentialError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: geo_settings_module_css_default.inlineError,
							children: credentialError
						}) : null
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_settings_module_css_default.footer,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							className: geo_settings_module_css_default.primaryButton,
							type: "button",
							"data-testid": "geo-settings-save",
							disabled: busy || !snapshot.writable || !dirty,
							onClick: () => {
								save();
							},
							children: busy ? "保存中…" : "保存配置"
						}),
						saved ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: geo_settings_module_css_default.success,
							children: "配置已保存"
						}) : null,
						failure ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: geo_settings_module_css_default.failure,
							role: "alert",
							children: failure
						}) : null
					]
				})
			] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_settings_module_css_default.section,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_settings_module_css_default.sectionHeading,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: geo_settings_module_css_default.sectionTitle,
						children: "运行隔离"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: geo_settings_module_css_default.switch,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
								className: geo_settings_module_css_default.switchInput,
								type: "checkbox",
								role: "switch",
								checked: restrictTools,
								disabled: isolationBusy || !snapshot.writable,
								"data-testid": "geo-restrict-tools",
								onChange: (event) => {
									setRestriction(event.target.checked);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: `${geo_settings_module_css_default.switchTrack} ${restrictTools ? geo_settings_module_css_default.switchTrackOn : ""}`,
								"aria-hidden": "true",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.switchThumb })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: geo_settings_module_css_default.switchLabel,
								children: restrictTools ? "已开启 · 仅 GEO 工具" : "已关闭 · 保留全部工具"
							})
						]
					})]
				}), isolationError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: geo_settings_module_css_default.inlineError,
					children: isolationError
				}) : null]
			}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_settings_module_css_default.section,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: geo_settings_module_css_default.sectionHeading,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
							className: geo_settings_module_css_default.sectionTitle,
							children: "审批档位"
						})
					}),
					POLICY_DOMAINS.map(({ key, name: name$1, scope: scope$1 }) => {
						const current = policyValue(key);
						const pending = policyBusyKey !== void 0 || !snapshot.writable;
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: geo_settings_module_css_default.policyRow,
							"data-testid": `geo-policy-${key}`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.policyMeta,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_settings_module_css_default.policyName,
									children: name$1
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_settings_module_css_default.policyScope,
									children: scope$1
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.segmented,
								role: "group",
								"aria-label": `${name$1}审批档位`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: current === "ask" ? `${geo_settings_module_css_default.segmentButton} ${geo_settings_module_css_default.segmentButtonActive}` : geo_settings_module_css_default.segmentButton,
									type: "button",
									"aria-pressed": current === "ask",
									"data-testid": `geo-policy-${key}-ask`,
									disabled: pending,
									onClick: () => {
										setPolicy(key, "ask");
									},
									children: "询问"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									className: current === "agent" ? `${geo_settings_module_css_default.segmentButton} ${geo_settings_module_css_default.segmentButtonActive}` : geo_settings_module_css_default.segmentButton,
									type: "button",
									"aria-pressed": current === "agent",
									"data-testid": `geo-policy-${key}-agent`,
									disabled: pending,
									onClick: () => {
										setPolicy(key, "agent");
									},
									children: "自动"
								})]
							})]
						}, key);
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: geo_settings_module_css_default.hint,
						children: "「自动」授权智能体按判断直接执行该域写入；发布确认类操作始终需要人工审批。"
					}),
					policyError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: geo_settings_module_css_default.inlineError,
						children: policyError
					}) : null
				]
			})] })]
		}) : null]
	});
}

//#endregion
//#region \0geo-dsh-css:D:\wt\geo-agent-full-flow\geo-agent-dsh-plugin\src\client\geo-workflow.module.css.mjs
const css = ".SOS-nW_page{flex-direction:column;width:100%;max-width:980px;height:100%;min-height:0;margin:0 auto;display:flex;overflow:hidden}.SOS-nW_pageScroll{scrollbar-gutter:stable;flex:1;min-height:0;overflow:hidden auto}.SOS-nW_pageContent{flex-direction:column;gap:16px;padding-bottom:24px;display:flex}.SOS-nW_wrap{flex-direction:column;gap:12px;min-width:0;display:flex}.SOS-nW_totals{color:var(--dsw-alias-label-secondary,#4b5563);gap:16px;font-size:12px;display:flex}.SOS-nW_totalItem strong{color:var(--dsw-alias-label-primary,#111827);font-size:14px;font-weight:600}.SOS-nW_totalAlert,.SOS-nW_totalAlert strong{color:#b45309}.SOS-nW_cellAwaiting{background:color-mix(in srgb, #d97706 7%, var(--dsw-alias-bg-layer-3,#fff));border-left-color:#d97706;animation:1.8s ease-in-out infinite SOS-nW_awaitingPulse}.SOS-nW_cellAwaiting .SOS-nW_cellIndex{color:#fff;background:#d97706;font-weight:700}.SOS-nW_cellAwaiting .SOS-nW_cellStatus{color:#b45309;font-weight:600}@keyframes SOS-nW_awaitingPulse{0%,to{border-color:var(--dsw-alias-border-secondary,#e5e7eb)}50%{border-color:#d97706}}@media (prefers-reduced-motion:reduce){.SOS-nW_cellAwaiting{animation:none}}.SOS-nW_cellHint{color:#b45309;font-size:11px;line-height:1.4}.SOS-nW_cellReason{color:#dc2626;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;display:block;overflow:hidden}.SOS-nW_grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:0;padding:0;list-style:none;display:grid}.SOS-nW_cell{border:1px solid var(--dsw-alias-border-secondary,#e5e7eb);border-left:3px solid var(--dsw-alias-border-secondary,#e5e7eb);background:var(--dsw-alias-bg-layer-3,#fff);border-radius:8px;gap:10px;min-width:0;padding:10px 12px;display:flex}.SOS-nW_cellIndex{background:var(--dsw-alias-bg-layer-2,#f3f4f6);width:18px;height:18px;color:var(--dsw-alias-label-tertiary,#6b7280);font-variant-numeric:tabular-nums;border-radius:50%;flex:none;place-items:center;font-size:10px;display:grid}.SOS-nW_cellBody{flex-direction:column;gap:3px;min-width:0;display:flex}.SOS-nW_cellTop{justify-content:space-between;align-items:baseline;gap:8px;display:flex}.SOS-nW_cellName{color:var(--dsw-alias-label-primary,#111827);font-size:13px;font-weight:600}.SOS-nW_cellStatus{color:var(--dsw-alias-label-tertiary,#6b7280);flex:none;font-size:11px}.SOS-nW_cellCounts{font-variant-numeric:tabular-nums;flex-wrap:wrap;gap:6px;font-size:11px;display:flex}.SOS-nW_countWrite{color:#1f6feb}.SOS-nW_countRead{color:var(--dsw-alias-label-tertiary,#6b7280)}.SOS-nW_countNone{color:var(--dsw-alias-label-tertiary,#9ca3af)}.SOS-nW_cellOp{color:var(--dsw-alias-label-secondary,#4b5563);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;display:block;overflow:hidden}.SOS-nW_cellDone{border-left-color:#1f6feb}.SOS-nW_cellDone .SOS-nW_cellIndex{color:#fff;background:#1f6feb}.SOS-nW_cellDone .SOS-nW_cellStatus{color:#1f6feb}.SOS-nW_cellActive{background:color-mix(in srgb, #1f6feb 6%, var(--dsw-alias-bg-layer-3,#fff));border-left-color:#1f6feb}.SOS-nW_cellActive .SOS-nW_cellIndex{color:#1f6feb;background:#1f6feb29;font-weight:600}.SOS-nW_cellActive .SOS-nW_cellStatus{color:#1f6feb;font-weight:600}.SOS-nW_cellFailed{background:color-mix(in srgb, #dc2626 5%, var(--dsw-alias-bg-layer-3,#fff));border-left-color:#dc2626}.SOS-nW_cellFailed .SOS-nW_cellIndex{color:#fff;background:#dc2626;font-weight:700}.SOS-nW_cellFailed .SOS-nW_cellStatus{color:#dc2626;font-weight:600}.SOS-nW_cellUnknown{background:color-mix(in srgb, #d97706 5%, var(--dsw-alias-bg-layer-3,#fff));border-left-color:#d97706}.SOS-nW_cellUnknown .SOS-nW_cellIndex{color:#b45309;background:#d977062e;font-weight:700}.SOS-nW_cellUnknown .SOS-nW_cellStatus{color:#b45309;font-weight:600}.SOS-nW_stepperCard{border:1px solid var(--dsw-alias-border-secondary,#e5e7eb);border-radius:12px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}.SOS-nW_heading{margin:0;font-size:14px;font-weight:600}.SOS-nW_caption[data-status=failed]{color:#dc2626}.SOS-nW_caption[data-status=awaiting]{color:#b45309;font-weight:600}.SOS-nW_caption[data-status=unknown]{color:#b45309}.SOS-nW_caption{color:var(--dsw-alias-label-secondary,#4b5563);margin:0;font-size:12px}.SOS-nW_idle{color:var(--dsw-alias-label-tertiary,#6b7280);margin:0;font-size:12px}.SOS-nW_pendingBanner{color:var(--dsw-alias-label-primary,#111827);background:#f59e0b1a;border:1px solid #f59e0b73;border-radius:10px;align-items:baseline;gap:8px;padding:10px 12px;font-size:12px;display:flex}.SOS-nW_pendingDot{flex:none}";
const tagId = "@geo-internal/geo-agent-dsh-plugin/geo-workflow.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@geo-internal/geo-agent-dsh-plugin";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
var geo_workflow_module_css_default = {
	"cellActive": "SOS-nW_cellActive",
	"caption": "SOS-nW_caption",
	"cellReason": "SOS-nW_cellReason",
	"heading": "SOS-nW_heading",
	"cellFailed": "SOS-nW_cellFailed",
	"cell": "SOS-nW_cell",
	"cellIndex": "SOS-nW_cellIndex",
	"grid": "SOS-nW_grid",
	"cellOp": "SOS-nW_cellOp",
	"pageContent": "SOS-nW_pageContent",
	"cellAwaiting": "SOS-nW_cellAwaiting",
	"awaitingPulse": "SOS-nW_awaitingPulse",
	"cellUnknown": "SOS-nW_cellUnknown",
	"countNone": "SOS-nW_countNone",
	"stepperCard": "SOS-nW_stepperCard",
	"countWrite": "SOS-nW_countWrite",
	"pendingBanner": "SOS-nW_pendingBanner",
	"wrap": "SOS-nW_wrap",
	"totals": "SOS-nW_totals",
	"cellTop": "SOS-nW_cellTop",
	"totalAlert": "SOS-nW_totalAlert",
	"cellCounts": "SOS-nW_cellCounts",
	"idle": "SOS-nW_idle",
	"cellBody": "SOS-nW_cellBody",
	"cellDone": "SOS-nW_cellDone",
	"pageScroll": "SOS-nW_pageScroll",
	"totalItem": "SOS-nW_totalItem",
	"page": "SOS-nW_page",
	"cellHint": "SOS-nW_cellHint",
	"cellStatus": "SOS-nW_cellStatus",
	"cellName": "SOS-nW_cellName",
	"countRead": "SOS-nW_countRead",
	"pendingDot": "SOS-nW_pendingDot"
};

//#endregion
//#region src/client/GeoWorkbenchPage.tsx
const PROJECTION_KEY = "geoWorkflow";
const MAX_BOUND_SESSIONS = 12;
function stageActivity(view) {
	return (view?.stages ?? []).reduce((total, stage) => total + (stage.calls > 0 ? 1 : 0), 0);
}
const STATUS_CLASS = {
	pending: "cellPending",
	awaiting: "cellAwaiting",
	active: "cellActive",
	done: "cellDone",
	failed: "cellFailed",
	unknown: "cellUnknown"
};
/** 状态码 → 网格单元格里的短标签（中文，与 UI 术语一致）。 */
const STATUS_LABEL = {
	pending: "待开始",
	awaiting: "等审批",
	active: "进行中",
	done: "已完成",
	failed: "被拒",
	unknown: "待查证"
};
/**
* 操作名 → 中文业务叫法。进度页面向运营员，不出现 OpenAPI 操作名。
* 只收 OpsRun 里真正会发生的动作；未命中的不猜、不拆词，直接不显示，
* 由阶段名承担说明作用（英文标识对使用人群没有信息量）。
*/
const OPERATION_LABEL = {
	get_projects_by_projectid: "读取项目档案",
	put_projects_by_projectid: "更新项目档案",
	post_projects_by_projectid_start: "启动项目",
	get_platforms: "读取平台清单",
	get_platform_accounts: "读取客户平台账号",
	get_evidence_sources: "查看资料列表",
	post_evidence_sources_upload: "上传资料",
	post_evidence_sources_retry_parse: "重新解析资料",
	get_fact_revisions: "查看事实库",
	post_facts: "新建事实",
	post_facts_ai_extract: "提取事实候选",
	post_facts_ai_extract_by_runid_retry: "重试事实提取",
	post_facts_ai_extract_by_runid_candidates_batch_confirm: "批量确认事实候选",
	post_facts_ai_extract_by_runid_candidates_by_candidateid_confirm: "确认事实候选",
	post_facts_ai_extract_by_runid_candidates_by_candidateid_reject: "驳回事实候选",
	post_fact_revisions_by_id_confirm: "确认事实",
	post_fact_revisions_by_id_dispute: "标记事实存疑",
	post_fact_revisions_by_id_disable: "停用事实",
	post_fact_revisions_by_id_reenable: "重新启用事实",
	post_content_elements: "新建内容要素",
	post_content_elements_ai_extract: "提炼内容要素",
	post_content_elements_by_elementid_ai_split: "拆分内容要素",
	post_content_elements_by_elementid_enabled: "启用/停用内容要素",
	get_questions: "查看问题库",
	post_questions: "新建问题",
	post_questions_by_id_transition: "启用/停用问题",
	post_question_generation_tasks: "发起问题生成",
	post_question_generation_tasks_by_taskid_regenerate: "重新生成问题",
	get_query_panels: "查看问题面板",
	post_query_panels: "新建问题面板",
	post_query_panels_by_panelid_new_version: "问题面板新建版本",
	post_query_panels_by_panelid_freeze: "冻结问题面板",
	get_content_generation_tasks: "查看生成任务",
	post_content_generation_tasks: "创建生成任务",
	post_content_generation_tasks_by_id_execute: "执行内容生成",
	post_content_generation_tasks_by_id_cancel: "取消内容生成",
	put_content_generation_tasks_by_id: "更新生成任务",
	get_article_versions: "查看文章",
	post_article_card_compose: "生成文章卡片",
	get_publish_records: "查看发布记录",
	get_publish_balance: "查询发布账户余额",
	get_media_catalog_resources: "查询媒体目录",
	post_publish_records_preview: "发布预览与报价",
	post_publish_records_preview_from_resource: "按媒体发布预览",
	post_publish_records_confirm: "确认发布",
	post_publish_records_manual: "人工发布",
	post_publish_records_by_id_cancel: "取消发布",
	post_publish_records_by_id_republish: "重新发布",
	post_publish_records_by_id_query_order: "查询发布订单",
	get_detection_plans: "查看检测计划",
	post_detection_plans: "创建检测计划",
	post_detection_plans_by_id_execute: "执行检测计划",
	get_detection_runs_by_planid_progress: "查看检测进度",
	post_detection_runs: "发起检测",
	post_detection_runs_by_runid_pause: "暂停检测",
	post_detection_attempts_by_id_retry: "重试检测项",
	post_detection_attempts_by_id_query_order: "查询检测订单",
	get_run_reports: "查看运行报告",
	get_customer_geo_reports: "查看客户报告",
	post_customer_geo_reports: "生成客户报告",
	post_customer_geo_reports_by_reportid_retry: "重新生成客户报告",
	post_detection_runs_by_runid_customer_geo_reports: "按检测运行生成报告",
	get_report_revisions: "查看报告修订",
	post_report_revisions: "创建报告修订",
	post_report_revisions_by_id_confirm: "确认报告",
	post_report_revisions_by_id_return: "退回报告",
	post_report_revisions_by_id_artifacts_render: "渲染报告产物",
	get_score_snapshots: "查看评分快照"
};
/** 把目录操作名翻成业务叫法；未收录的不显示英文标识。 */
function operationLabel(operation) {
	if (!operation) return "";
	return OPERATION_LABEL[operation] ?? "";
}
/**
* 订阅所有可见会话的 geoWorkflow 投影，挑出「正在跑或最近跑过 GEO」的那个。
* 订阅本身是扇入式的：任何会话的投影变化都会触发一次重新挑选。
*/
function useLatestGeoStage(sessions) {
	const [view, setView] = (0, react.useState)();
	(0, react.useEffect)(() => {
		if (!sessions) return;
		const stops = /* @__PURE__ */ new Map();
		const reconcile = () => {
			const summaries = Object.values(sessions.list.getSnapshot()?.byId ?? {}).filter((summary) => summary?.blank !== true && typeof summary.id === "string").sort((left, right) => {
				if (right.running === true !== (left.running === true)) return right.running === true ? 1 : -1;
				return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
			}).slice(0, MAX_BOUND_SESSIONS);
			for (const [sessionId, stop] of stops) if (!summaries.some((summary) => summary.id === sessionId)) {
				stop();
				stops.delete(sessionId);
			}
			for (const summary of summaries) {
				const sessionId = summary.id;
				if (stops.has(sessionId)) continue;
				const store = sessions.binding(sessionId)?.session?.projections?.faceOf(PROJECTION_KEY);
				if (!store) continue;
				stops.set(sessionId, store.subscribe(reconcile));
			}
			let best;
			for (const summary of summaries) {
				const candidate = (sessions.binding(summary.id)?.session?.projections?.faceOf(PROJECTION_KEY))?.getSnapshot();
				if (candidate && stageActivity(candidate) > 0) {
					best = candidate;
					break;
				}
			}
			setView((current) => sameStages(current, best) ? current : best);
		};
		const stopList = sessions.list.subscribe?.(reconcile);
		reconcile();
		return () => {
			stopList?.();
			for (const stop of stops.values()) stop();
			stops.clear();
		};
	}, [sessions]);
	return view;
}
function sameStages(left, right) {
	if (left === right) return true;
	return JSON.stringify(left?.stages ?? []) === JSON.stringify(right?.stages ?? []);
}
/** 订阅单个会话的 geoWorkflow 投影；会话或服务不可用时保持空态。 */
function useSessionGeoStage(sessions, sessionId) {
	const [view, setView] = (0, react.useState)();
	(0, react.useEffect)(() => {
		if (!sessions || !sessionId) return;
		const store = sessions.binding(sessionId)?.session?.projections?.faceOf(PROJECTION_KEY);
		if (!store) return;
		setView(store.getSnapshot());
		return store.subscribe(() => setView(store.getSnapshot()));
	}, [sessions, sessionId]);
	return view;
}
/** 订阅同一会话的 userQuestions 投影，返回等待用户答复的提问批次。 */
function useSessionPendingQuestions(sessions, sessionId) {
	const [active, setActive] = (0, react.useState)([]);
	(0, react.useEffect)(() => {
		if (!sessions || !sessionId) return;
		const store = sessions.binding(sessionId)?.session?.projections?.faceOf("userQuestions");
		if (!store) return;
		const reconcile = () => setActive(store.getSnapshot()?.active ?? []);
		reconcile();
		return store.subscribe(reconcile);
	}, [sessions, sessionId]);
	return active;
}
/** 阶段网格：canonical 顺序 + 五态 + 写入/只读分列计数；无 GEO 活动时给一句空态。 */
function GeoStageStepper(props) {
	const { view } = props;
	const stages = view?.stages ?? [];
	const active = stages.find((stage) => stage.status === "active");
	const failed = stages.find((stage) => stage.status === "failed");
	const unknown = stages.find((stage) => stage.status === "unknown");
	const awaiting = stages.find((stage) => stage.status === "awaiting");
	const writes = stages.reduce((total, stage) => total + (stage.writes ?? 0), 0);
	const reads = stages.reduce((total, stage) => total + (stage.reads ?? 0), 0);
	const pendingApprovals = stages.filter((stage) => stage.status === "awaiting").length;
	if (stages.length === 0 || stages.every((stage) => stage.calls === 0)) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: geo_workflow_module_css_default.idle,
		children: "会话里还没有 GEO 活动；AI 开始调用 GEO 工具后，这里会显示流程进度。"
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: geo_workflow_module_css_default.wrap,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_workflow_module_css_default.totals,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: geo_workflow_module_css_default.totalItem,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: writes }), " 写操作"]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: geo_workflow_module_css_default.totalItem,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: reads }), " 只读探测"]
					}),
					pendingApprovals > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
						className: `${geo_workflow_module_css_default.totalItem} ${geo_workflow_module_css_default.totalAlert}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: pendingApprovals }), " 项等审批"]
					}) : null
				]
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
				className: geo_workflow_module_css_default.grid,
				children: stages.map((stage, index) => {
					const writesForStage = stage.writes ?? 0;
					const readsForStage = stage.reads ?? 0;
					const opLabel = operationLabel(stage.lastOp);
					return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: `${geo_workflow_module_css_default.cell} ${geo_workflow_module_css_default[STATUS_CLASS[stage.status] ?? "cellPending"]}`,
						title: opLabel || stage.label,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: geo_workflow_module_css_default.cellIndex,
							children: index + 1
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: geo_workflow_module_css_default.cellBody,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: geo_workflow_module_css_default.cellTop,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_workflow_module_css_default.cellName,
										children: stage.label
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_workflow_module_css_default.cellStatus,
										children: STATUS_LABEL[stage.status] ?? stage.status
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: geo_workflow_module_css_default.cellCounts,
									children: [
										writesForStage > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: geo_workflow_module_css_default.countWrite,
											children: ["写 ", writesForStage]
										}) : null,
										readsForStage > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
											className: geo_workflow_module_css_default.countRead,
											children: ["只读 ", readsForStage]
										}) : null,
										writesForStage === 0 && readsForStage === 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: geo_workflow_module_css_default.countNone,
											children: "—"
										}) : null
									]
								}),
								stage.status === "awaiting" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_workflow_module_css_default.cellHint,
									children: "等待你在审批弹窗中确认"
								}) : null,
								stage.status === "failed" && stage.rejectionReason ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_workflow_module_css_default.cellReason,
									title: stage.rejectionReason,
									children: stage.rejectionReason
								}) : null,
								opLabel ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_workflow_module_css_default.cellOp,
									children: opLabel
								}) : null
							]
						})]
					}, stage.key);
				})
			}),
			awaiting ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: geo_workflow_module_css_default.caption,
				"data-status": "awaiting",
				children: [
					"等审批：",
					awaiting.label,
					operationLabel(awaiting.lastOp) ? ` · ${operationLabel(awaiting.lastOp)}` : "",
					" — 请在审批弹窗中确认后继续。"
				]
			}) : null,
			!awaiting && failed ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: geo_workflow_module_css_default.caption,
				"data-status": "failed",
				children: [
					"被拒：",
					failed.label,
					operationLabel(failed.lastOp) ? ` · ${operationLabel(failed.lastOp)}` : "",
					failed.rejectionReason ? ` — ${failed.rejectionReason}` : ""
				]
			}) : null,
			!awaiting && !failed && unknown ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
				className: geo_workflow_module_css_default.caption,
				"data-status": "unknown",
				children: [
					"待查证：",
					unknown.label,
					operationLabel(unknown.lastOp) ? ` · ${operationLabel(unknown.lastOp)}` : "",
					" — 结果未确认，请先核对 GEO 记录再重试。"
				]
			}) : null,
			!awaiting && !failed && !unknown ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
				className: geo_workflow_module_css_default.caption,
				children: active ? `进行中：${active.label}${operationLabel(active.lastOp) ? ` · ${operationLabel(active.lastOp)}` : ""}` : writes > 0 ? "本轮写操作已收敛；AI 进入下一步时会自动更新。" : "目前只有只读探测，尚未发生写操作。"
			}) : null
		]
	});
}
/** 会话视图标签页：与「轨迹」同级，展示当前会话的 GEO 流程进度与待答复提问。 */
function GeoSessionProgressView(props) {
	const { sessionId, sessions } = props;
	const view = useSessionGeoStage(sessions, sessionId);
	const pending = useSessionPendingQuestions(sessions, sessionId);
	const firstQuestion = pending[0]?.questions?.[0];
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
		className: geo_workflow_module_css_default.page,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: geo_workflow_module_css_default.pageScroll,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_workflow_module_css_default.pageContent,
				children: [pending.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_workflow_module_css_default.pendingBanner,
					"data-testid": "geo-pending-questions",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: geo_workflow_module_css_default.pendingDot,
						"aria-hidden": "true",
						children: "⏳"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: pending.length > 1 ? `AI 有 ${pending.length} 批问题等待你的答复，请在对话中作答。` : `AI 正在等待你的答复${firstQuestion?.question ? `：「${firstQuestion.question}」` : "，请在对话中作答。"} 答复后才会继续。` })]
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_workflow_module_css_default.stepperCard,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: geo_workflow_module_css_default.heading,
						children: "GEO 流程进度"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeoStageStepper, { view })]
				})]
			})
		})
	});
}
/** 主视图页：三层滚动容器（照官方 TaskManagerPage），上半流程进度、下半设置卡。 */
function GeoWorkbenchPage(props) {
	const { sessions,...cardProps } = props;
	const view = useLatestGeoStage(sessions);
	return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("section", {
		className: geo_workflow_module_css_default.page,
		children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
			className: geo_workflow_module_css_default.pageScroll,
			children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_workflow_module_css_default.pageContent,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: geo_workflow_module_css_default.stepperCard,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
						className: geo_workflow_module_css_default.heading,
						children: "GEO 流程进度"
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeoStageStepper, { view })]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeoSettingsCard, { ...cardProps })]
			})
		})
	});
}

//#endregion
//#region src/client/locales.ts
const zh = {
	title: "GEO 工作台",
	progress: "GEO 进度"
};
const en = {
	title: "GEO Workbench",
	progress: "GEO Progress"
};

//#endregion
//#region src/client/index.tsx
const LOCALE_NAMESPACE = "settings.geo-workbench";
const BUNDLE_PACKAGE = "@geo-internal/geo-agent-dsh-plugin";
const PROFILE_ENTRY_ID = "geo-agent-dsh-plugin";
const PAGE_KEY = "geo-workbench";
/** 侧边栏入口图标，契约同官方插件：接收 { size }。 */
function GeoIcon({ size = 16 }) {
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
		width: size,
		height: size,
		viewBox: "0 0 16 16",
		fill: "none",
		"aria-hidden": "true",
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("circle", {
				cx: "8",
				cy: "8",
				r: "6.2",
				stroke: "currentColor",
				strokeWidth: "1.4"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("ellipse", {
				cx: "8",
				cy: "8",
				rx: "2.9",
				ry: "6.2",
				stroke: "currentColor",
				strokeWidth: "1.1"
			}),
			/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
				d: "M1.8 8h12.4",
				stroke: "currentColor",
				strokeWidth: "1.1"
			})
		]
	});
}
const name = "geo-agent-dsh-plugin-client";
const inject = [
	"slots",
	"locale",
	"remote",
	"remote.credentials"
];
function apply(rawContext) {
	const ctx = rawContext;
	ctx.effect(() => ctx.locale.register(LOCALE_NAMESPACE, {
		zh,
		en
	}), "geo-workbench: settings copy");
	const t = ctx.locale.bind(LOCALE_NAMESPACE);
	const sessionsRef = { current: void 0 };
	ctx.inject(["sessions"], (scope) => {
		sessionsRef.current = scope.sessions;
	});
	ctx.effect(() => ctx.slots.inject("conversation.view", () => ctx.slots.register({
		name: "conversation.view",
		id: "geo-progress",
		order: 15,
		locale: LOCALE_NAMESPACE,
		label: () => t("progress"),
		inject: (sessionId) => ({
			sessionId,
			sessions: sessionsRef.current
		})
	}, GeoSessionProgressView)), "geo-workbench: conversation progress tab");
	ctx.inject(["configForms"], (scoped) => {
		try {
			const formScope = scoped.configForms?.get(PROFILE_ENTRY_ID);
			if (!formScope) {
				console.warn(`[geo-agent-dsh-plugin] 宿主未提供「${PROFILE_ENTRY_ID}」的配置表单，GEO 工作台卡片不会出现。`);
				return;
			}
			if (typeof formScope.getSnapshot !== "function" || typeof formScope.subscribe !== "function" || typeof formScope.set !== "function") {
				console.warn(`[geo-agent-dsh-plugin] 配置表单 scope 形状不符合预期；实际键：${Object.keys(formScope).join(",") || "(无)"}`);
				return;
			}
			const getSnapshot = formScope.getSnapshot.bind(formScope);
			const subscribe = formScope.subscribe.bind(formScope);
			const scope = {
				...formScope,
				getSnapshot,
				subscribe,
				set: formScope.set.bind(formScope)
			};
			const useSnapshot = () => (0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot);
			const credentialRemote = (() => {
				try {
					return scoped.remote?.credentials;
				} catch {
					return;
				}
			})();
			const injected = () => ({
				scope,
				useSnapshot,
				t,
				credentials: credentialRemote,
				sessions: sessionsRef.current
			});
			scoped.effect(() => scoped.slots.inject("plugins.bundle.config", () => scoped.slots.register({
				name: "plugins.bundle.config",
				key: BUNDLE_PACKAGE,
				locale: LOCALE_NAMESPACE,
				inject: injected
			}, (ownerProps = {}) => ownerProps.view === "summary" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(GeoSettingsCard, { ...injected() }))), "geo-workbench: plugin configuration card");
			scoped.effect(() => scoped.slots.inject("main", () => scoped.slots.register({
				name: "main",
				key: PAGE_KEY,
				locale: LOCALE_NAMESPACE,
				inject: injected
			}, GeoWorkbenchPage)), "geo-workbench: main page");
			scoped.effect(() => scoped.slots.inject("sidebar.panellist", () => scoped.slots.register({
				name: "sidebar.panellist",
				id: PAGE_KEY,
				order: 20,
				locale: LOCALE_NAMESPACE,
				label: () => t("title")
			}, GeoIcon)), "geo-workbench: sidebar entry");
		} catch (error) {
			console.warn("[geo-agent-dsh-plugin] GEO 工作台卡片注册失败：", error);
		}
	});
}

//#endregion
exports.apply = apply;
exports.inject = inject;
exports.name = name;
return module.exports; } });
//# sourceMappingURL=client.js.map