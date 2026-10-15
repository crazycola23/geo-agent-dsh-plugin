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
	if (!projectId) throw new TypeError("项目编号必须是有效的 GEO 项目编号：正整数");
	return { apiToken: `${`GEO_PROJECT_${projectId}`}_API_TOKEN` };
}

//#endregion
//#region src/runtime-compat.js
/**
* 运行环境兼容判定。客户端半体与设置卡共用，不依赖任何 Node 专有 API。
*
* 这个判定必须能在「服务端半体根本没起来」的时候给出结论 —— 版本不匹配就是
* 这个样子：DSH 在 import 之前就把插件拒了，我们自己的代码一行都没跑。所以
* 判定只看客户端自己拿得到的事实：
*
*   1. 配置表单 scope 在不在。它由 DSH 按 profile 条目提供，与我们的模块无关；
*      拿不到就说明这一条没激活。
*   2. 宿主插件清单（remote.pluginInventory，软依赖）。它给出 fiberPhase，以及
*      DSH 自己记下的激活错误原文 —— 版本不匹配的那句话就在里面。
*
* 两者都拿不到时结论是 unknown，绝不放大成 active：版本问题最怕的就是静默通过。
*/
const PLUGIN_PACKAGE = "@geo-internal/geo-agent-dsh-plugin";
const PLUGIN_ENTRY_ID = "geo-agent-dsh-plugin";
/**
* 已实际验证过的 DSH 运行时范围。
*
* 跨 0.x 的 minor 时，本插件用到的 ctx.tools / ctx.agents / ctx.credentials /
* ctx.systemPrompt 都可能变，所以「验证过」只到 0.2.x。超出这一行的实例不再被
* 静默放行：卡片顶部会给出提示（见 judgeRuntime）。
*/
const VERIFIED_DSH_RANGE = "^0.2.0-rc.2";
const VERIFIED_DSH_LINE = "0.2";
const REQUIRED_DSH_PEERS = Object.freeze(["@deepseek-ai/dsh-tools", "@deepseek-ai/dsh-credentials"]);
const RUNTIME_VERDICT = Object.freeze({
	ACTIVE: "active",
	FAILED: "failed",
	DISABLED: "disabled",
	MISSING: "missing",
	UNSUPPORTED: "unsupported",
	UNKNOWN: "unknown"
});
/**
* 运行时版本是否落在验证过的行上。
*
* 只比 major.minor，不自己实现 semver 区间比较 —— 手写比较器出错的方式很隐蔽，
* 而这里要回答的问题本来就是「是不是 0.2 这一行」。预发布版本（0.2.0-rc.2）与
* 正式版（0.2.0）都算在 0.2 行上，这正是我们要的粒度。
*
* 空串 = 读不到版本 → 返回 undefined（unknown），不当作「不支持」。
*/
function runtimeVersionSupported(version) {
	if (typeof version !== "string") return void 0;
	const trimmed = version.trim();
	if (trimmed === "") return void 0;
	const match = /^(\d+)\.(\d+)\./.exec(trimmed);
	if (!match) return void 0;
	return `${match[1]}.${match[2]}` === VERIFIED_DSH_LINE;
}
function errorTextOf(entry) {
	const message = entry?.meta?.error;
	return typeof message === "string" ? message.trim() : "";
}
/**
* 在插件清单里找本条目。
*
* 按 entryId 找是主路径；moduleName 兜底是因为 entryId 由 profile 的 id 决定，
* 别人手写 cordis.patch.yml 时可能取成别的名字。
*/
function findRuntimeEntry(entries, entryId = PLUGIN_ENTRY_ID) {
	if (!Array.isArray(entries)) return void 0;
	return entries.find((entry) => entry && (entry.entryId === entryId || entry.moduleName === PLUGIN_PACKAGE));
}
/**
* 判定当前运行环境。
*
* @param entries 插件清单（remote.pluginInventory.list() 的 entries）；拿不到时传 undefined
* @param hasConfigForm 宿主是否提供了本条目的配置表单 scope
* @param runtimeVersion 宿主 DSH 版本（服务端半体探测，经配置快照送到卡片）；读不到时传空串
* @returns {{verdict: string, detail: string, entry?: object}}
*/
function judgeRuntime({ entries, hasConfigForm, runtimeVersion } = {}) {
	if (runtimeVersionSupported(runtimeVersion) === false) return {
		verdict: RUNTIME_VERDICT.UNSUPPORTED,
		detail: String(runtimeVersion).trim()
	};
	if (!Array.isArray(entries)) return hasConfigForm ? {
		verdict: RUNTIME_VERDICT.UNKNOWN,
		detail: ""
	} : {
		verdict: RUNTIME_VERDICT.FAILED,
		detail: ""
	};
	const entry = findRuntimeEntry(entries);
	if (!entry) return {
		verdict: RUNTIME_VERDICT.MISSING,
		detail: ""
	};
	if (entry.enabled === false) return {
		verdict: RUNTIME_VERDICT.DISABLED,
		detail: "",
		entry
	};
	if (entry.fiberPhase === "failed") return {
		verdict: RUNTIME_VERDICT.FAILED,
		detail: errorTextOf(entry),
		entry
	};
	if (entry.fiberPhase === "active") return {
		verdict: RUNTIME_VERDICT.ACTIVE,
		detail: "",
		entry
	};
	return {
		verdict: RUNTIME_VERDICT.UNKNOWN,
		detail: errorTextOf(entry),
		entry
	};
}
/**
* 判定结果 → 卡片上要显示的话。
*
* tone 决定颜色：ok 绿、warn 黄、error 红、muted 灰。detail 里带上插件要求的范围，
* 因为运营看到提示的第一件事就是「那我该装哪个版本」。
*/
function runtimeNotice(result) {
	const required = `本插件只在 DSH ${VERIFIED_DSH_RANGE} 上验证过`;
	switch (result?.verdict) {
		case RUNTIME_VERDICT.ACTIVE: return {
			tone: "ok",
			title: "运行环境正常",
			detail: required
		};
		case RUNTIME_VERDICT.UNSUPPORTED: return {
			tone: "error",
			title: `当前 DSH ${result.detail || ""} 不在验证范围内`,
			detail: `${required}；这一行之外的接口可能有变，工具能不能用没有保证。请换用 DSH ${VERIFIED_DSH_LINE}.x，或确认这一行上功能正常后再继续。`
		};
		case RUNTIME_VERDICT.DISABLED: return {
			tone: "warn",
			title: "插件条目被禁用了",
			detail: "GEO 工具不会注册。在 DSH 的插件列表里把它重新启用，然后完全退出 DSH 再启动。"
		};
		case RUNTIME_VERDICT.MISSING: return {
			tone: "error",
			title: "当前 DSH 没有注册这个插件",
			detail: `${required}。请确认装在了当前 profile，且装完完全退出 DSH 再启动。`
		};
		case RUNTIME_VERDICT.FAILED: return {
			tone: "error",
			title: "插件在当前 DSH 上没能激活",
			detail: `${required}；GEO 工具因此不会出现。先换回验证过的 DSH 版本再排查。`
		};
		default: return {
			tone: "muted",
			title: "无法自动检测运行环境",
			detail: `${required}。若工具没出现，先确认 DSH 版本在这个范围内。`
		};
	}
}

//#endregion
//#region \0geo-dsh-css:D:\wt\geo-agent-full-flow\geo-agent-dsh-plugin\src\client\geo-settings.module.css.mjs
const css$1 = ".HQDdta_card{color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-3,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:12px}.HQDdta_header{width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;align-items:center;gap:12px;padding:14px 16px;display:flex}.HQDdta_header:focus-visible,.HQDdta_input:focus-visible,.HQDdta_primaryButton:focus-visible,.HQDdta_ghostButton:focus-visible,.HQDdta_clearButton:focus-visible,.HQDdta_dangerButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:2px}.HQDdta_title{font-size:15px;font-weight:600;line-height:1.4}.HQDdta_hint{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:12px;line-height:1.5}.HQDdta_badge,.HQDdta_credentialState{color:var(--dsw-alias-label-secondary,#4b5563);white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:999px;align-items:center;gap:6px;padding:3px 8px;font-size:11px;display:inline-flex}.HQDdta_badgeReady,.HQDdta_credentialStateReady{color:var(--dsw-alias-state-success-primary,#1a7f37);border-color:var(--dsw-alias-state-success-primary,#1a7f37)}.HQDdta_stateDot{background:var(--dsw-alias-state-warning-primary,#9a6700);border-radius:50%;width:6px;height:6px}.HQDdta_badgeReady .HQDdta_stateDot,.HQDdta_credentialStateReady .HQDdta_stateDot{background:var(--dsw-alias-state-success-primary,#1a7f37)}.HQDdta_chevron{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:18px;line-height:1;transition:transform .15s}.HQDdta_chevronOpen{transform:rotate(180deg)}.HQDdta_body{flex-direction:column;gap:16px;padding:0 16px 14px;display:flex}.HQDdta_section{flex-direction:column;gap:12px;display:flex}.HQDdta_sectionHeading{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;display:flex}.HQDdta_sectionTitle{color:var(--dsw-alias-label-primary,#1f2329);margin:0;font-size:13px;font-weight:600}.HQDdta_emptyProjects{color:var(--dsw-alias-label-tertiary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px dashed var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;padding:14px;font-size:12px;line-height:1.5}.HQDdta_projectCard{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;flex-direction:column;gap:12px;padding:12px;display:flex}.HQDdta_projectHeader{flex-wrap:wrap;justify-content:space-between;align-items:center;gap:9px;display:flex}.HQDdta_projectTitleGroup{align-items:center;gap:9px;min-width:0;display:flex}.HQDdta_projectIcon{width:26px;height:26px;color:var(--dsw-alias-state-business-primary,#4f8cff);background:color-mix(in srgb, var(--dsw-alias-state-business-primary,#4f8cff) 12%, transparent);border-radius:7px;flex:0 0 26px;place-items:center;font-size:11px;font-weight:700;display:grid}.HQDdta_projectTitleGroup>div{flex-direction:column;gap:2px;min-width:0;display:flex}.HQDdta_projectTitle{color:var(--dsw-alias-label-primary,#1f2329);text-overflow:ellipsis;white-space:nowrap;font-size:12px;overflow:hidden}.HQDdta_credentialStates{flex-wrap:wrap;gap:6px;display:flex}.HQDdta_field{flex-direction:column;flex:1 1 0;gap:5px;min-width:0;display:flex}.HQDdta_label{color:var(--dsw-alias-label-primary,#1f2329);font-size:12px;font-weight:500}.HQDdta_input{box-sizing:border-box;width:100%;min-height:34px;color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);font:inherit;border-radius:6px;padding:7px 9px;font-size:12px}.HQDdta_input:disabled{opacity:.65;cursor:not-allowed}.HQDdta_twoColumns{gap:12px;display:flex}.HQDdta_runtimeBanner{border:1px solid #0000;border-radius:8px;flex-direction:column;gap:6px;padding:10px 12px;font-size:12px;line-height:1.5;display:flex}.HQDdta_runtimeBannerError{color:var(--dsw-alias-state-error-primary,#d1242f);border-color:var(--dsw-alias-state-error-primary,#d1242f);background:color-mix(in srgb, var(--dsw-alias-state-error-primary,#d1242f) 8%, transparent)}.HQDdta_runtimeBannerWarn{color:var(--dsw-alias-state-warning-primary,#9a6700);border-color:var(--dsw-alias-state-warning-primary,#9a6700);background:color-mix(in srgb, var(--dsw-alias-state-warning-primary,#9a6700) 8%, transparent)}.HQDdta_runtimeBannerTitle{font-weight:600}.HQDdta_runtimeBannerDetail{color:inherit}.HQDdta_runtimeBannerRaw{font-family:var(--dsw-font-mono,ui-monospace, SFMono-Regular, Menlo, monospace);overflow-wrap:anywhere;opacity:.85;font-size:11px}.HQDdta_inlineError,.HQDdta_failure{color:var(--dsw-alias-state-error-primary,#d1242f);margin:0;font-size:12px;line-height:1.45}.HQDdta_confirmRow{color:var(--dsw-alias-label-secondary,#4b5563);flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;display:flex}.HQDdta_footer{flex-wrap:wrap;align-items:center;gap:9px;padding-top:2px;display:flex}.HQDdta_primaryButton,.HQDdta_ghostButton,.HQDdta_dangerButton,.HQDdta_clearButton{cursor:pointer;font:inherit;border-radius:6px;padding:7px 12px;font-size:12px}.HQDdta_primaryButton{color:var(--dsw-alias-label-primary-foreground,#fff);background:var(--dsw-alias-button-primary-fill,#4f8cff);border:1px solid #0000;font-weight:500}.HQDdta_primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3b76e0)}.HQDdta_primaryButton:disabled,.HQDdta_ghostButton:disabled,.HQDdta_dangerButton:disabled,.HQDdta_clearButton:disabled{opacity:.55;cursor:not-allowed}.HQDdta_ghostButton{color:var(--dsw-alias-label-secondary,#4b5563);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de)}.HQDdta_clearButton{color:var(--dsw-alias-label-tertiary,#6b7280);text-underline-offset:2px;background:0 0;border:0;align-self:flex-start;padding:2px 0;text-decoration:underline}.HQDdta_dangerButton{color:var(--dsw-alias-state-error-primary,#d1242f);background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-state-error-primary,#d1242f)}.HQDdta_success{color:var(--dsw-alias-state-success-primary,#1a7f37);font-size:11px;line-height:1.4}@media (width<=620px){.HQDdta_header{gap:8px;padding:12px}.HQDdta_body{padding:0 12px 12px}.HQDdta_twoColumns{flex-direction:column}.HQDdta_projectHeader{flex-direction:column;align-items:flex-start}}.HQDdta_switch{cursor:pointer;user-select:none;flex:none;align-items:center;gap:8px;display:inline-flex}.HQDdta_switchInput{clip:rect(0 0 0 0);white-space:nowrap;border:0;width:1px;height:1px;margin:-1px;padding:0;position:absolute;overflow:hidden}.HQDdta_switchTrack{border:1px solid var(--dsw-alias-border-l2,#d0d7de);background:var(--dsw-alias-bg-layer-1,#e5e7eb);border-radius:9px;flex:none;width:34px;height:18px;transition:background-color .15s,border-color .15s;display:inline-block;position:relative}.HQDdta_switchTrackOn{border-color:var(--dsw-alias-state-warning-primary,#d97706);background:var(--dsw-alias-state-warning-primary,#d97706)}.HQDdta_switchThumb{background:#fff;border-radius:50%;width:14px;height:14px;transition:transform .15s;position:absolute;top:1px;left:1px}.HQDdta_switchTrackOn .HQDdta_switchThumb{transform:translate(16px)}.HQDdta_switchInput:focus-visible+.HQDdta_switchTrack{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:1px}.HQDdta_switchInput:disabled+.HQDdta_switchTrack{cursor:not-allowed;opacity:.5}.HQDdta_switchLabel{color:var(--dsw-alias-label-secondary,#4b5563);white-space:nowrap;font-size:11px}.HQDdta_tabs{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;gap:4px;padding:3px;display:flex}.HQDdta_tab{color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;background:0 0;border:none;border-radius:6px;flex:1;padding:6px 10px;font-size:12px;font-weight:600}.HQDdta_tabActive{color:var(--dsw-alias-label-primary,#1f2329);background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 2px #00000014}.HQDdta_policyRow{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:8px;padding:10px 12px;display:flex}.HQDdta_policyMeta{flex-direction:column;gap:2px;min-width:0;display:flex}.HQDdta_policyName{color:var(--dsw-alias-label-primary,#1f2329);font-size:12px;font-weight:600}.HQDdta_policyScope{color:var(--dsw-alias-label-tertiary,#6b7280);font-size:11px;line-height:1.4}.HQDdta_segmented{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:6px;flex:none;gap:2px;padding:2px;display:inline-flex}.HQDdta_segmentButton{color:var(--dsw-alias-label-secondary,#4b5563);cursor:pointer;background:0 0;border:none;border-radius:4px;padding:3px 12px;font-size:11px;font-weight:600}.HQDdta_segmentButtonActive{color:#fff;background:var(--dsw-alias-state-business-primary,#4f8cff)}.HQDdta_segmentButton:disabled{cursor:not-allowed;opacity:.5}.HQDdta_segmentButton:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#4f8cff);outline-offset:1px}.HQDdta_tokenExpiry{align-items:baseline;gap:8px;font-size:12px;display:flex}.HQDdta_tokenExpiryLabel{color:var(--dsw-alias-label-secondary);flex:none}.HQDdta_tokenExpiryValue{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}.HQDdta_tokenExpiry[data-level=warn] .HQDdta_tokenExpiryValue{color:var(--dsw-alias-state-warn-label);font-weight:600}.HQDdta_tokenExpiry[data-level=expired] .HQDdta_tokenExpiryValue{color:var(--dsw-alias-state-error-primary);font-weight:600}.HQDdta_tokenExpiry[data-level=unknown] .HQDdta_tokenExpiryValue{color:var(--dsw-alias-label-caption)}.HQDdta_inlineCode{background:color-mix(in srgb, currentColor 12%, transparent);user-select:all;overflow-wrap:anywhere;border-radius:4px;margin:0 4px;padding:1px 6px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;display:inline-block}";
const tagId$1 = "@geo-internal/geo-agent-dsh-plugin/geo-settings.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId$1) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@geo-internal/geo-agent-dsh-plugin";
	tag.dataset.pluginCss = tagId$1;
	tag.textContent = css$1;
	document.head.appendChild(tag);
}
var geo_settings_module_css_default = {
	"badgeReady": "HQDdta_badgeReady",
	"badge": "HQDdta_badge",
	"switchTrackOn": "HQDdta_switchTrackOn",
	"segmentButton": "HQDdta_segmentButton",
	"failure": "HQDdta_failure",
	"emptyProjects": "HQDdta_emptyProjects",
	"confirmRow": "HQDdta_confirmRow",
	"projectHeader": "HQDdta_projectHeader",
	"success": "HQDdta_success",
	"chevronOpen": "HQDdta_chevronOpen",
	"field": "HQDdta_field",
	"section": "HQDdta_section",
	"credentialStateReady": "HQDdta_credentialStateReady",
	"chevron": "HQDdta_chevron",
	"projectTitleGroup": "HQDdta_projectTitleGroup",
	"card": "HQDdta_card",
	"runtimeBannerDetail": "HQDdta_runtimeBannerDetail",
	"ghostButton": "HQDdta_ghostButton",
	"switch": "HQDdta_switch",
	"tokenExpiryLabel": "HQDdta_tokenExpiryLabel",
	"body": "HQDdta_body",
	"footer": "HQDdta_footer",
	"clearButton": "HQDdta_clearButton",
	"projectIcon": "HQDdta_projectIcon",
	"hint": "HQDdta_hint",
	"inlineError": "HQDdta_inlineError",
	"tokenExpiry": "HQDdta_tokenExpiry",
	"runtimeBannerRaw": "HQDdta_runtimeBannerRaw",
	"tab": "HQDdta_tab",
	"twoColumns": "HQDdta_twoColumns",
	"policyRow": "HQDdta_policyRow",
	"credentialStates": "HQDdta_credentialStates",
	"projectTitle": "HQDdta_projectTitle",
	"header": "HQDdta_header",
	"policyName": "HQDdta_policyName",
	"stateDot": "HQDdta_stateDot",
	"projectCard": "HQDdta_projectCard",
	"sectionTitle": "HQDdta_sectionTitle",
	"tabs": "HQDdta_tabs",
	"policyScope": "HQDdta_policyScope",
	"label": "HQDdta_label",
	"policyMeta": "HQDdta_policyMeta",
	"segmentButtonActive": "HQDdta_segmentButtonActive",
	"runtimeBanner": "HQDdta_runtimeBanner",
	"primaryButton": "HQDdta_primaryButton",
	"switchTrack": "HQDdta_switchTrack",
	"inlineCode": "HQDdta_inlineCode",
	"sectionHeading": "HQDdta_sectionHeading",
	"switchInput": "HQDdta_switchInput",
	"dangerButton": "HQDdta_dangerButton",
	"switchLabel": "HQDdta_switchLabel",
	"segmented": "HQDdta_segmented",
	"input": "HQDdta_input",
	"runtimeBannerError": "HQDdta_runtimeBannerError",
	"runtimeBannerTitle": "HQDdta_runtimeBannerTitle",
	"tokenExpiryValue": "HQDdta_tokenExpiryValue",
	"switchThumb": "HQDdta_switchThumb",
	"tabActive": "HQDdta_tabActive",
	"credentialState": "HQDdta_credentialState",
	"runtimeBannerWarn": "HQDdta_runtimeBannerWarn",
	"title": "HQDdta_title"
};

//#endregion
//#region src/client/GeoSettingsCard.tsx
/**
* 回答方式三档。顺序即推荐优先级：第一个同时是缺省值与提问时的推荐项。
* 文案与 src/operator-mode.js 的 MODE_CATALOG 是同义表述——那一份给模型，
* 这一份给运营；改一处务必同步另一处。
*/
const ANSWER_MODES = [
	{
		key: "brief",
		name: "简洁模式",
		scope: "结论先行、编号步骤、单屏读完；不复述、不铺垫、不客套"
	},
	{
		key: "operator",
		name: "高级微调运营模式",
		scope: "专业但说业务语言：只讲结论、依据与下一步，不出现接口名、英文报错或技术方案"
	},
	{
		key: "standard",
		name: "标准模式",
		scope: "保留接口名、错误码、字段口径等技术细节，适合自己排查时用"
	}
];
/** 需要立刻在卡片顶部示警的判定：这三类是「装了也用不了」。 */
const ALERTING_VERDICTS = [
	RUNTIME_VERDICT.FAILED,
	RUNTIME_VERDICT.MISSING,
	RUNTIME_VERDICT.DISABLED,
	RUNTIME_VERDICT.UNSUPPORTED
];
function normalizeBasePathInput(input) {
	const value = input.trim();
	if (value === "" || value === "/") return "";
	if (!value.startsWith("/")) throw new Error("转发路径前缀要以 / 开头，例如 /prod-api。");
	if (value.includes("//") || value.includes("\\") || value.includes("?") || value.includes("#")) throw new Error("转发路径前缀只能是一段路径，不要带查询参数、片段或反斜杠。");
	return value.replace(/\/+$/, "");
}
function normalizeOrigin(input) {
	const value = input.trim();
	if (!value) throw new Error("请填写 GEO 服务地址。");
	const url = new URL(value.includes("://") ? value : `https://${value}`);
	if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("请填写协议、地址和端口，不要填写路径、用户名或查询参数。");
	if (url.protocol !== "https:" && ![
		"localhost",
		"127.0.0.1",
		"[::1]"
	].includes(url.hostname)) throw new Error("项目令牌要求使用 HTTPS 地址；内网地址也必须套上 HTTPS。");
	return url.origin;
}
/** 仅做布尔化：合法项目编号（正整数）与运行时同一套正则来源。 */
function validProjectId(value) {
	return normalizeProjectId(value) !== void 0;
}
function errorMessage(error) {
	return error instanceof Error ? error.message : "保存失败，请检查 DSH 的配置服务是否正常。";
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
	if (!result.ok) throw new Error(result.error?.message || "读不到 DSH 里保存的凭据状态。");
	return result.value;
}
async function writeCredential(credentials, ref, value) {
	const result = await credentials.set(ref, value);
	if (!result.ok) throw new Error(result.error?.message || "DSH 拒绝保存这个项目的访问令牌。");
}
async function removeCredential(credentials, ref) {
	const result = await credentials.unset(ref);
	if (!result.ok) throw new Error(result.error?.message || "DSH 拒绝删除这个项目的访问令牌。");
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
	const { scope, useSnapshot, t, credentials, sessions } = props;
	const snapshot = useSnapshot();
	const value = snapshot.value ?? {};
	const geoView = useLatestGeoStage(sessions);
	const pet = geoView?.pet;
	const tokenByProject = new Map((geoView?.tokens ?? []).map((token) => [token.projectId, token]));
	const [expanded, setExpanded] = (0, react.useState)(true);
	const [apiBaseUrl, setApiBaseUrl] = (0, react.useState)(value.apiBaseUrl ?? "");
	const [apiBasePath, setApiBasePath] = (0, react.useState)(value.apiBasePath ?? "");
	const [evidenceDirectory, setEvidenceDirectory] = (0, react.useState)(value.evidenceDirectory ?? "");
	const [exportDirectory, setExportDirectory] = (0, react.useState)(value.exportDirectory ?? "");
	const [memoryDirectory, setMemoryDirectory] = (0, react.useState)(value.memoryDirectory ?? "");
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
	const [instantFieldBusy, setInstantFieldBusy] = (0, react.useState)(false);
	const [memoryError, setMemoryError] = (0, react.useState)();
	const [runtime, setRuntime] = (0, react.useState)(void 0);
	const nextDraftId = (0, react.useRef)(0);
	(0, react.useEffect)(() => {
		if (dirty) return;
		setApiBaseUrl(value.apiBaseUrl ?? "");
		setApiBasePath(value.apiBasePath ?? "");
		setEvidenceDirectory(value.evidenceDirectory ?? "");
		setExportDirectory(value.exportDirectory ?? "");
		setMemoryDirectory(value.memoryDirectory ?? "");
		setTimeoutSeconds(String(Math.round((value.timeoutMs ?? 3e4) / 1e3)));
		setProjects(draftsFrom(value.projects));
	}, [
		dirty,
		value.apiBaseUrl,
		value.apiBasePath,
		value.evidenceDirectory,
		value.exportDirectory,
		value.memoryDirectory,
		value.timeoutMs,
		value.projects
	]);
	const refsInUse = projects.flatMap((project) => validProjectId(project.projectId) ? Object.values(projectCredentialRefs(project.projectId.trim())) : []);
	const refsKey = [...new Set(refsInUse)].sort().join("|");
	(0, react.useEffect)(() => {
		if (!credentials) {
			setCredentialError("当前 DSH 没有提供凭据设置入口。");
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
	/**
	* 运行环境判定。
	*
	* 探测失败不静默：拿不到清单时判成 unknown 并如实写在「运行环境」一栏，
	* 而不是让卡片看起来一切正常 —— 版本问题最怕的就是静默通过。
	*/
	(0, react.useEffect)(() => {
		let stale = false;
		const hasConfigForm = props.hasConfigForm !== false;
		const runtimeVersion = typeof value.runtimeVersion === "string" ? value.runtimeVersion : "";
		const settle = (entries) => {
			if (!stale) setRuntime(judgeRuntime({
				entries,
				hasConfigForm,
				runtimeVersion
			}));
		};
		if (!props.runtimeProbe) {
			settle(void 0);
			return () => {
				stale = true;
			};
		}
		props.runtimeProbe().then((result) => settle(result?.entries)).catch(() => settle(void 0));
		return () => {
			stale = true;
		};
	}, [
		props.runtimeProbe,
		props.hasConfigForm,
		value.runtimeVersion
	]);
	const configuredProjectCount = projects.filter((project) => {
		if (!validProjectId(project.projectId)) return false;
		return credentialState[projectCredentialRefs(project.projectId.trim()).apiToken]?.configured === true;
	}).length;
	const endpointReady = apiBaseUrl.trim().length > 0;
	const statusCopy = endpointReady && configuredProjectCount > 0 ? `待验证 · ${configuredProjectCount} 个项目` : "待配置";
	const runtimeView = runtime ? runtimeNotice(runtime) : void 0;
	const detectedVersion = typeof value.runtimeVersion === "string" ? value.runtimeVersion.trim() : "";
	const runtimeAlert = runtime && ALERTING_VERDICTS.includes(runtime.verdict) ? runtimeView : void 0;
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
			setFailure("当前 DSH 没有提供凭据设置入口，无法安全保存访问令牌。");
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
				setFailure("每个项目都要填写有效的项目编号（正整数）。");
				return;
			}
			if (seenProjectIds.has(projectId)) {
				setFailure(`项目编号 ${projectId} 重复了；每个项目只能配一个令牌。`);
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
				setFailure(`请粘贴为项目 ${projectId} 创建的访问令牌。`);
				return;
			}
			if (apiToken && credentialState[refs.apiToken]?.writable === false) {
				setFailure(`项目 ${projectId} 的访问令牌由外部管理，不能在这里覆盖。`);
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
			await scope.set("exportDirectory", exportDirectory.trim());
			await scope.set("memoryDirectory", memoryDirectory.trim());
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
			setExportDirectory(exportDirectory.trim());
			setMemoryDirectory(memoryDirectory.trim());
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
				setCredentialError("配置写入之后读不到最新凭据状态；请重新打开设置卡核对。");
			}
			if (projectSettingsSaved) setFailure(`项目设置已保存，但旧凭据的清理没做完：${message}`);
			else if (credentialWritesComplete && credentialWriteAttempted) setFailure(`项目凭据已保存，但普通设置没全部保存：${message}`);
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
	const memoryEnabled = value.memoryEnabled !== false;
	const answerMode = ANSWER_MODES.some((mode) => mode.key === value.answerModeDefault) ? value.answerModeDefault : "brief";
	const operatorIdentity = value.operatorIdentity === "off" ? "off" : "geo-only";
	const petEnabled = value.petEnabled !== false;
	const petPresent = pet === void 0 || pet.installed;
	const setMemoryField = async (field, next) => {
		setInstantFieldBusy(true);
		setMemoryError(void 0);
		try {
			await scope.set(field, next);
		} catch (error) {
			setMemoryError(errorMessage(error));
		} finally {
			setInstantFieldBusy(false);
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
			children: [
				runtimeAlert ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: `${geo_settings_module_css_default.runtimeBanner} ${runtimeAlert.tone === "error" ? geo_settings_module_css_default.runtimeBannerError : geo_settings_module_css_default.runtimeBannerWarn}`,
					role: "alert",
					"data-testid": "geo-runtime-banner",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							className: geo_settings_module_css_default.runtimeBannerTitle,
							children: runtimeAlert.title
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: geo_settings_module_css_default.runtimeBannerDetail,
							children: runtimeAlert.detail
						}),
						runtime?.detail ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
							className: geo_settings_module_css_default.runtimeBannerRaw,
							"data-testid": "geo-runtime-banner-raw",
							children: runtime.detail
						}) : null
					]
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
				}),
				tab === "connection" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: geo_settings_module_css_default.section,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
								className: geo_settings_module_css_default.sectionTitle,
								children: "GEO 服务"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: "GEO 服务地址",
								hint: "只填协议、地址和端口",
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
								label: "资料暂存目录",
								hint: "可选。运营直接把文件拖进对话是主路径（推荐这样用）；这个目录只是给「文件已在本机某处、想按名字引用」留的落点",
								value: evidenceDirectory,
								placeholder: "默认：DSH 数据目录下的 geo-evidence",
								testId: "geo-evidence-directory",
								disabled: busy || !snapshot.writable,
								onChange: (next) => {
									markDirty();
									setEvidenceDirectory(next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: "文章导出目录",
								hint: "把稿件导出成 .md 文件的地方；留空即用默认目录（DSH 数据目录下的 geo-articles）",
								value: exportDirectory,
								placeholder: "默认：DSH 数据目录下的 geo-articles",
								testId: "geo-export-directory",
								disabled: busy || !snapshot.writable,
								onChange: (next) => {
									markDirty();
									setExportDirectory(next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
								label: "项目记忆目录",
								hint: "按项目编号分文件存放 AI 的操作习惯与回答方式；留空即用默认目录（DSH 数据目录下的 geo-memory）",
								value: memoryDirectory,
								placeholder: "默认：DSH 数据目录下的 geo-memory",
								testId: "geo-memory-directory",
								disabled: busy || !snapshot.writable,
								onChange: (next) => {
									markDirty();
									setMemoryDirectory(next);
								}
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.twoColumns,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Field, {
									label: "转发路径前缀",
									hint: "服务地址前还有一层转发路径时填它，直接访问就留空",
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
								const expiry = tokenSummary(tokenByProject.get(projectId));
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
												hint: "AI 跑任务时会用同一个项目编号。",
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
											hint: "保存后不再显示；换新令牌时先在 GEO 撤销旧的，再粘贴新的。",
											value: project.apiToken,
											type: "password",
											placeholder: tokenInfo?.configured ? "已安全保存；留空表示不更改" : "粘贴该项目的访问令牌",
											testId: `geo-project-api-token-${index}`,
											autoComplete: "new-password",
											disabled: busy || tokenInfo?.writable === false,
											onChange: (next) => updateProject(project.draftKey, "apiToken", next)
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: geo_settings_module_css_default.tokenExpiry,
											"data-level": expiry.level,
											"data-testid": `geo-project-token-expiry-${index}`,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: geo_settings_module_css_default.tokenExpiryLabel,
												children: "令牌有效期"
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: geo_settings_module_css_default.tokenExpiryValue,
												children: expiry.text
											})]
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
											children: "这份凭据由外部管理，请到它的来源处更换或清理。"
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
				] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: geo_settings_module_css_default.section,
						"data-testid": "geo-runtime-section",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: geo_settings_module_css_default.sectionTitle,
									children: "运行环境"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									className: `${geo_settings_module_css_default.badge} ${runtime?.verdict === RUNTIME_VERDICT.ACTIVE ? geo_settings_module_css_default.badgeReady : ""}`,
									"data-testid": "geo-runtime-verdict",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.stateDot }), runtime?.verdict === RUNTIME_VERDICT.ACTIVE ? "正常" : runtime?.verdict === RUNTIME_VERDICT.UNSUPPORTED ? "未验证" : !runtime || runtime.verdict === RUNTIME_VERDICT.UNKNOWN ? "检测不到" : "不可用"]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: geo_settings_module_css_default.hint,
								children: [detectedVersion ? `宿主 DSH ${detectedVersion}。` : "", runtimeView ? runtimeView.detail : "正在检测运行环境…"]
							}),
							runtime?.detail ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.inlineError,
								"data-testid": "geo-runtime-error",
								children: runtime.detail
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: geo_settings_module_css_default.section,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: geo_settings_module_css_default.sectionTitle,
									children: "回答方式与项目记忆"
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: geo_settings_module_css_default.switch,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: geo_settings_module_css_default.switchInput,
											type: "checkbox",
											role: "switch",
											checked: memoryEnabled,
											disabled: instantFieldBusy || !snapshot.writable,
											"data-testid": "geo-memory-enabled",
											onChange: (event) => {
												setMemoryField("memoryEnabled", event.target.checked);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${geo_settings_module_css_default.switchTrack} ${memoryEnabled ? geo_settings_module_css_default.switchTrackOn : ""}`,
											"aria-hidden": "true",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.switchThumb })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: geo_settings_module_css_default.switchLabel,
											children: memoryEnabled ? "记忆已开启 · 按项目分别保存" : "记忆已关闭 · 不再读写本地文件"
										})
									]
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.hint,
								children: "每个项目第一次开工时，AI 会用提问让你选一种回答方式，选择结果存在该项目自己的记忆文件里，之后不再重复问。 这里的「缺省回答方式」只在项目还没选过时作为推荐项出现。"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.policyRow,
								"data-testid": "geo-operator-identity",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: geo_settings_module_css_default.policyMeta,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_settings_module_css_default.policyName,
										children: "职责范围"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_settings_module_css_default.policyScope,
										children: operatorIdentity === "geo-only" ? "只做 GEO 运营：写代码、分析简历、翻译、闲聊这类请求会被挡回并把话头引回项目" : "不限制：这个运行时也接受与 GEO 无关的通用请求（维护本插件时用）"
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: geo_settings_module_css_default.segmented,
									role: "group",
									"aria-label": "职责范围",
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: operatorIdentity === "geo-only" ? `${geo_settings_module_css_default.segmentButton} ${geo_settings_module_css_default.segmentButtonActive}` : geo_settings_module_css_default.segmentButton,
										type: "button",
										"aria-pressed": operatorIdentity === "geo-only",
										"data-testid": "geo-operator-identity-geo-only",
										disabled: instantFieldBusy || !snapshot.writable,
										onClick: () => {
											setMemoryField("operatorIdentity", "geo-only");
										},
										children: "只做 GEO"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: operatorIdentity === "off" ? `${geo_settings_module_css_default.segmentButton} ${geo_settings_module_css_default.segmentButtonActive}` : geo_settings_module_css_default.segmentButton,
										type: "button",
										"aria-pressed": operatorIdentity === "off",
										"data-testid": "geo-operator-identity-off",
										disabled: instantFieldBusy || !snapshot.writable,
										onClick: () => {
											setMemoryField("operatorIdentity", "off");
										},
										children: "不限制"
									})]
								})]
							}),
							ANSWER_MODES.map(({ key, name: name$1, scope: scope$1 }) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.policyRow,
								"data-testid": `geo-answer-mode-${key}`,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: geo_settings_module_css_default.policyMeta,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_settings_module_css_default.policyName,
										children: name$1
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: geo_settings_module_css_default.policyScope,
										children: scope$1
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: geo_settings_module_css_default.segmented,
									role: "group",
									"aria-label": "缺省回答方式",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										className: answerMode === key ? `${geo_settings_module_css_default.segmentButton} ${geo_settings_module_css_default.segmentButtonActive}` : geo_settings_module_css_default.segmentButton,
										type: "button",
										"aria-pressed": answerMode === key,
										"data-testid": `geo-answer-mode-${key}-select`,
										disabled: instantFieldBusy || !snapshot.writable,
										onClick: () => {
											setMemoryField("answerModeDefault", key);
										},
										children: answerMode === key ? "缺省" : "设为缺省"
									})
								})]
							}, key)),
							memoryError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.inlineError,
								children: memoryError
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: geo_settings_module_css_default.section,
						"data-testid": "geo-pet-section",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: geo_settings_module_css_default.sectionHeading,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
									className: geo_settings_module_css_default.sectionTitle,
									children: "桌宠"
								}), petPresent ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
									className: geo_settings_module_css_default.switch,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
											className: geo_settings_module_css_default.switchInput,
											type: "checkbox",
											role: "switch",
											checked: petEnabled,
											disabled: instantFieldBusy || !snapshot.writable,
											"data-testid": "geo-pet-enabled",
											onChange: (event) => {
												setMemoryField("petEnabled", event.target.checked);
											}
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: `${geo_settings_module_css_default.switchTrack} ${petEnabled ? geo_settings_module_css_default.switchTrackOn : ""}`,
											"aria-hidden": "true",
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_settings_module_css_default.switchThumb })
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											className: geo_settings_module_css_default.switchLabel,
											children: petEnabled ? "开着 · 跟着 AI 的工作状态动" : "已关闭 · 不再加载桌宠插件"
										})
									]
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: geo_settings_module_css_default.policyScope,
									"data-testid": "geo-pet-absent",
									children: "这个 profile 里还没装"
								})]
							}),
							petPresent ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.hint,
								children: "关掉它 = 在本 profile 的配置里代管一行 disabled，由 DSH 自己热重载生效，不用重启；打开就把它撤掉。 桌宠显示的是这个会话的状态：思考中 / 干活中（带当前任务一句话）/ 等你回复 / 成功或失败——那行任务文字来自 AI 写的待办，不写就只会显示「干活中」。"
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
								className: geo_settings_module_css_default.hint,
								children: [
									"桌宠是独立插件，不跟这个工作台一起打包——想要就单独装：",
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", {
										className: geo_settings_module_css_default.inlineCode,
										"data-testid": "geo-pet-install-command",
										children: pet?.installCommand || "dsh plugin add github:12we21/cute-fat-fish-pet"
									}),
									"装完重启一次 DSH，再回这张卡就会看到开关；它会把 AI 的工作状态显示在桌面上（思考中 / 干活中 / 等你回复 / 成功或失败）。"
								]
							}),
							memoryError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.inlineError,
								children: memoryError
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
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
								children: "「自动」= 这类写入交给 AI 自行判断执行；发布确认类操作永远需要人工确认。"
							}),
							policyError ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
								className: geo_settings_module_css_default.inlineError,
								children: policyError
							}) : null
						]
					})
				] })
			]
		}) : null]
	});
}

//#endregion
//#region \0geo-dsh-css:D:\wt\geo-agent-full-flow\geo-agent-dsh-plugin\src\client\geo-workflow.module.css.mjs
const css = ".SOS-nW_page{flex-direction:column;width:100%;max-width:980px;height:100%;min-height:0;margin:0 auto;display:flex;overflow:hidden}.SOS-nW_pageScroll{scrollbar-gutter:stable;flex:1;min-height:0;overflow:hidden auto}.SOS-nW_pageContent{flex-direction:column;gap:16px;padding-bottom:24px;display:flex}.SOS-nW_wrap{flex-direction:column;gap:12px;min-width:0;display:flex}.SOS-nW_overview{flex-direction:column;gap:8px;display:flex}.SOS-nW_totals{color:var(--dsw-alias-label-secondary);align-items:baseline;gap:16px;font-size:12px;display:flex}.SOS-nW_totalItem{align-items:baseline;gap:4px;display:inline-flex}.SOS-nW_totalItem strong{color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}.SOS-nW_totalAlert,.SOS-nW_totalAlert strong{color:var(--dsw-alias-state-warn-label)}.SOS-nW_rail{gap:3px;width:100%;display:flex}.SOS-nW_railSegment{background:var(--dsw-alias-bg-module-platform);border-radius:2px;flex:1;height:4px;transition:background-color .2s}.SOS-nW_railSegment[data-status=active]{background:var(--dsw-alias-state-business-primary)}.SOS-nW_railSegment[data-status=done]{background:var(--dsw-alias-state-success-primary)}.SOS-nW_railSegment[data-status=failed]{background:var(--dsw-alias-state-error-primary)}.SOS-nW_railSegment[data-status=awaiting],.SOS-nW_railSegment[data-status=unknown]{background:var(--dsw-alias-state-warn-primary)}.SOS-nW_railSummary{color:var(--dsw-alias-label-caption);justify-content:space-between;align-items:baseline;gap:12px;font-size:11px;display:flex}.SOS-nW_grid{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;margin:0;padding:0;list-style:none;display:grid}@keyframes SOS-nW_cellIn{0%{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}.SOS-nW_cell{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-left:3px solid #0000;border-radius:8px;gap:10px;min-width:0;min-height:84px;padding:10px 12px;transition:border-color .15s,background-color .15s,transform .15s;animation:.32s ease-out both SOS-nW_cellIn;display:flex}.SOS-nW_cell:hover{border-color:var(--dsw-alias-border-l3);transform:translateY(-1px)}.SOS-nW_cellIndex{background:var(--dsw-alias-bg-module-platform);width:18px;height:18px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;border-radius:50%;flex:none;place-items:center;font-size:10px;display:grid}.SOS-nW_cellBody{flex-direction:column;gap:3px;min-width:0;display:flex}.SOS-nW_cellTop{justify-content:space-between;align-items:baseline;gap:8px;display:flex}.SOS-nW_cellName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}.SOS-nW_cellStatus{color:var(--dsw-alias-label-caption);flex:none;align-items:center;gap:4px;font-size:11px;display:inline-flex}.SOS-nW_cellDot{background:currentColor;border-radius:50%;width:6px;height:6px}.SOS-nW_cellCounts{font-variant-numeric:tabular-nums;flex-wrap:wrap;gap:6px;font-size:11px;display:flex}.SOS-nW_countWrite{color:var(--dsw-alias-state-business-primary)}.SOS-nW_countRead{color:var(--dsw-alias-label-tertiary)}.SOS-nW_countNone{color:var(--dsw-alias-label-caption)}.SOS-nW_cellOp{color:var(--dsw-alias-label-caption);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;display:block;overflow:hidden}@keyframes SOS-nW_statusPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, currentColor 45%, transparent)}to{box-shadow:0 0 0 6px #0000}}.SOS-nW_cellPending .SOS-nW_cellStatus{color:var(--dsw-alias-label-caption)}.SOS-nW_cellPending .SOS-nW_cellDot{background:var(--dsw-alias-border-l3)}.SOS-nW_cellProbed{border-left-color:var(--dsw-alias-border-l3)}.SOS-nW_cellProbed .SOS-nW_cellStatus{color:var(--dsw-alias-label-secondary,var(--dsw-alias-label-caption));font-weight:500}.SOS-nW_cellDone{border-left-color:var(--dsw-alias-state-success-primary)}.SOS-nW_cellDone .SOS-nW_cellIndex,.SOS-nW_cellActive .SOS-nW_cellIndex,.SOS-nW_cellFailed .SOS-nW_cellIndex,.SOS-nW_cellUnknown .SOS-nW_cellIndex{animation:.42s ease-out SOS-nW_statusPulse}.SOS-nW_cellDone .SOS-nW_cellIndex{background:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-label-primary-foreground,#fff)}.SOS-nW_cellDone .SOS-nW_cellStatus{color:var(--dsw-alias-state-success-primary)}.SOS-nW_cellActive{border-left-color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 6%, var(--dsw-alias-bg-layer-3))}.SOS-nW_cellActive .SOS-nW_cellIndex{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent);color:var(--dsw-alias-state-business-primary);font-weight:600}.SOS-nW_cellActive .SOS-nW_cellStatus{color:var(--dsw-alias-state-business-primary);font-weight:600}.SOS-nW_cellFailed{border-left-color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 5%, var(--dsw-alias-bg-layer-3))}.SOS-nW_cellFailed .SOS-nW_cellIndex{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:700}.SOS-nW_cellFailed .SOS-nW_cellStatus{color:var(--dsw-alias-state-error-primary);font-weight:600}.SOS-nW_cellUnknown{border-left-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 4%, var(--dsw-alias-bg-layer-3))}.SOS-nW_cellUnknown .SOS-nW_cellIndex{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label);font-weight:700}.SOS-nW_cellUnknown .SOS-nW_cellStatus{color:var(--dsw-alias-state-warn-label);font-weight:600}@keyframes SOS-nW_awaitingPulse{0%,to{box-shadow:0 0 0 0 color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent)}50%{box-shadow:0 0 0 4px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)}}.SOS-nW_cellAwaiting{border-left-color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, var(--dsw-alias-bg-layer-3))}.SOS-nW_cellAwaiting .SOS-nW_cellIndex{background:var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:700;animation:1.8s ease-in-out infinite SOS-nW_awaitingPulse}.SOS-nW_cellAwaiting .SOS-nW_cellStatus{color:var(--dsw-alias-state-warn-label);font-weight:600}.SOS-nW_cellHint{color:var(--dsw-alias-state-warn-label);font-size:11px;line-height:1.4}.SOS-nW_cellReason{color:var(--dsw-alias-state-error-primary);text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;display:block;overflow:hidden}.SOS-nW_stepperCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:14px 16px;display:flex}.SOS-nW_heading{margin:0;font-size:14px;font-weight:600}.SOS-nW_caption{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px}.SOS-nW_caption[data-status=failed]{color:var(--dsw-alias-state-error-primary)}.SOS-nW_caption[data-status=awaiting]{color:var(--dsw-alias-state-warn-label);font-weight:600}.SOS-nW_caption[data-status=unknown]{color:var(--dsw-alias-state-warn-label)}.SOS-nW_idle{color:var(--dsw-alias-label-caption);margin:0;font-size:12px}.SOS-nW_pendingBanner{border:1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);color:var(--dsw-alias-label-primary);border-radius:10px;align-items:baseline;gap:8px;padding:10px 12px;font-size:12px;display:flex}.SOS-nW_pendingDot{flex:none}.SOS-nW_noteSection{flex-direction:column;gap:8px;display:flex}.SOS-nW_noteHeading{color:var(--dsw-alias-label-secondary);margin:0;font-size:12px;font-weight:600}.SOS-nW_noteList{flex-direction:column;gap:5px;margin:0;padding:0;list-style:none;display:flex}.SOS-nW_noteItem{min-width:0;color:var(--dsw-alias-label-primary);align-items:baseline;gap:8px;font-size:12px;line-height:1.5;display:flex}.SOS-nW_noteTime{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;flex:none}.SOS-nW_noteStage{color:var(--dsw-alias-label-secondary);flex:none}.SOS-nW_noteStage:after{content:\"·\";color:var(--dsw-alias-label-caption);margin-left:6px}.SOS-nW_noteText{overflow-wrap:anywhere;min-width:0}@media (prefers-reduced-motion:reduce){.SOS-nW_cell,.SOS-nW_cellDone .SOS-nW_cellIndex,.SOS-nW_cellActive .SOS-nW_cellIndex,.SOS-nW_cellFailed .SOS-nW_cellIndex,.SOS-nW_cellUnknown .SOS-nW_cellIndex,.SOS-nW_cellAwaiting .SOS-nW_cellIndex{animation:none}.SOS-nW_cell:hover{transform:none}}";
const tagId = "@geo-internal/geo-agent-dsh-plugin/geo-workflow.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
	const tag = document.createElement("style");
	tag.dataset.plugin = "@geo-internal/geo-agent-dsh-plugin";
	tag.dataset.pluginCss = tagId;
	tag.textContent = css;
	document.head.appendChild(tag);
}
var geo_workflow_module_css_default = {
	"cellDot": "SOS-nW_cellDot",
	"totals": "SOS-nW_totals",
	"cellName": "SOS-nW_cellName",
	"countWrite": "SOS-nW_countWrite",
	"countNone": "SOS-nW_countNone",
	"awaitingPulse": "SOS-nW_awaitingPulse",
	"cellHint": "SOS-nW_cellHint",
	"noteHeading": "SOS-nW_noteHeading",
	"cellCounts": "SOS-nW_cellCounts",
	"cell": "SOS-nW_cell",
	"totalAlert": "SOS-nW_totalAlert",
	"cellProbed": "SOS-nW_cellProbed",
	"cellBody": "SOS-nW_cellBody",
	"cellUnknown": "SOS-nW_cellUnknown",
	"rail": "SOS-nW_rail",
	"cellDone": "SOS-nW_cellDone",
	"heading": "SOS-nW_heading",
	"cellIndex": "SOS-nW_cellIndex",
	"noteStage": "SOS-nW_noteStage",
	"totalItem": "SOS-nW_totalItem",
	"pendingBanner": "SOS-nW_pendingBanner",
	"cellStatus": "SOS-nW_cellStatus",
	"noteList": "SOS-nW_noteList",
	"countRead": "SOS-nW_countRead",
	"grid": "SOS-nW_grid",
	"caption": "SOS-nW_caption",
	"noteTime": "SOS-nW_noteTime",
	"railSegment": "SOS-nW_railSegment",
	"noteText": "SOS-nW_noteText",
	"cellActive": "SOS-nW_cellActive",
	"stepperCard": "SOS-nW_stepperCard",
	"noteSection": "SOS-nW_noteSection",
	"cellTop": "SOS-nW_cellTop",
	"cellReason": "SOS-nW_cellReason",
	"overview": "SOS-nW_overview",
	"pageScroll": "SOS-nW_pageScroll",
	"page": "SOS-nW_page",
	"railSummary": "SOS-nW_railSummary",
	"statusPulse": "SOS-nW_statusPulse",
	"cellAwaiting": "SOS-nW_cellAwaiting",
	"pendingDot": "SOS-nW_pendingDot",
	"wrap": "SOS-nW_wrap",
	"cellPending": "SOS-nW_cellPending",
	"cellFailed": "SOS-nW_cellFailed",
	"cellOp": "SOS-nW_cellOp",
	"cellIn": "SOS-nW_cellIn",
	"pageContent": "SOS-nW_pageContent",
	"idle": "SOS-nW_idle",
	"noteItem": "SOS-nW_noteItem"
};

//#endregion
//#region src/client/GeoWorkbenchPage.tsx
/**
* 令牌状态概要到人读文案：有效期 + 剩余天数 + 临期/过期告警。
* 数据来自上一次真实校验——没校验过就说没校验过，不猜一个日期出来。
*/
function tokenSummary(token) {
	const raw = token?.expiresAt;
	if (!raw) return {
		text: "调用一次连接校验后显示",
		level: "unknown"
	};
	const expires = new Date(raw);
	if (Number.isNaN(expires.getTime())) return {
		text: "有效期格式无法识别",
		level: "unknown"
	};
	const month = String(expires.getMonth() + 1).padStart(2, "0");
	const day = String(expires.getDate()).padStart(2, "0");
	const date = `${expires.getFullYear()}-${month}-${day}`;
	const days = Math.ceil((expires.getTime() - Date.now()) / 864e5);
	if (days < 0) return {
		text: `${date} 已过期`,
		level: "expired"
	};
	return {
		text: `${date}（剩 ${days} 天）`,
		level: days <= 7 ? "warn" : "ok"
	};
}
/** 说明条目的时间戳：只显示到分钟——运营员看的是先后，不是精确到秒。 */
function formatNoteTime(at) {
	if (typeof at !== "number" || at <= 0) return "";
	const date = new Date(at);
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
const PROJECTION_KEY = "geoWorkflow";
const MAX_BOUND_SESSIONS = 12;
function stageActivity(view) {
	return (view?.stages ?? []).reduce((total, stage) => total + (stage.calls > 0 ? 1 : 0), 0);
}
const STATUS_CLASS = {
	pending: "cellPending",
	probed: "cellProbed",
	awaiting: "cellAwaiting",
	active: "cellActive",
	done: "cellDone",
	failed: "cellFailed",
	unknown: "cellUnknown"
};
/** 状态码 → 网格单元格里的短标签（中文，与 UI 术语一致）。 */
const STATUS_LABEL = {
	pending: "待开始",
	probed: "已探测",
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
* 拒绝原因面向运营员：正文只用能读懂的话，技术报错原文退到 hover 的 title 里
* （排查时才需要）。服务端多数报错本身就是中文人话（「稿件版本不存在」），
* 原样显示；只有插件本地契约校验与英文技术句需要翻译。
*/
function humanizeRejection(reason) {
	if (!reason) return "";
	if (/canonical GEO OpenAPI contract/i.test(reason)) return "提交内容与系统要求不符（已记录）";
	if (!/[\u4e00-\u9fa5]/.test(reason) && /[A-Za-z]{4}/.test(reason)) return "系统未接受该提交（已记录）";
	return reason;
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
	const shape = (view) => JSON.stringify({
		stages: view?.stages ?? [],
		notes: view?.notes ?? [],
		tokens: view?.tokens ?? []
	});
	return shape(left) === shape(right);
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
	const doneCount = stages.filter((stage) => stage.status === "done").length;
	const focusStage = stages.find((stage) => stage.status === "awaiting") ?? stages.find((stage) => stage.status === "active") ?? stages.find((stage) => stage.status === "failed") ?? stages.find((stage) => stage.status === "unknown") ?? stages.filter((stage) => stage.status === "done").pop();
	const notes = view?.notes ?? [];
	if (stages.length === 0 || stages.every((stage) => stage.calls === 0) && notes.length === 0) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
		className: geo_workflow_module_css_default.idle,
		children: "会话里还没有 GEO 活动；AI 开始调用 GEO 工具后，这里会显示流程进度。"
	});
	return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
		className: geo_workflow_module_css_default.wrap,
		children: [
			/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: geo_workflow_module_css_default.overview,
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
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: geo_workflow_module_css_default.rail,
						role: "img",
						"aria-label": `流程进度：已完成 ${doneCount} / ${stages.length}`,
						children: stages.map((stage) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: geo_workflow_module_css_default.railSegment,
							"data-status": stage.status,
							title: `${stage.label} · ${STATUS_LABEL[stage.status] ?? stage.status}`
						}, stage.key))
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: geo_workflow_module_css_default.railSummary,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [
							"已完成 ",
							doneCount,
							" / ",
							stages.length
						] }), focusStage ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: ["当前：", focusStage.label] }) : null]
					})
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
						style: { animationDelay: `${index % 4 * 40}ms` },
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
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
										className: geo_workflow_module_css_default.cellStatus,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: geo_workflow_module_css_default.cellDot }), STATUS_LABEL[stage.status] ?? stage.status]
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
									children: humanizeRejection(stage.rejectionReason)
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
			notes.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: geo_workflow_module_css_default.noteSection,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
					className: geo_workflow_module_css_default.noteHeading,
					children: "进度说明"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("ol", {
					className: geo_workflow_module_css_default.noteList,
					children: notes.map((note, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("li", {
						className: geo_workflow_module_css_default.noteItem,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("time", {
								className: geo_workflow_module_css_default.noteTime,
								children: formatNoteTime(note.at)
							}),
							note.stageLabel ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: geo_workflow_module_css_default.noteStage,
								children: note.stageLabel
							}) : null,
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: geo_workflow_module_css_default.noteText,
								children: note.text
							})
						]
					}, `${note.seq}-${index}`))
				})]
			}) : null,
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
					failed.rejectionReason ? ` — ${humanizeRejection(failed.rejectionReason)}` : ""
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
const BUNDLE_PACKAGE = PLUGIN_PACKAGE;
const PROFILE_ENTRY_ID = PLUGIN_ENTRY_ID;
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
/**
* 配置表单不可用时的占位 scope。
*
* 条目没激活（版本不匹配是最常见原因）时 DSH 给不出配置表单，但卡片本身必须
* 还能渲染 —— 那正是唯一能告诉运营「为什么没工具」的地方。这里给一个只读 scope，
* 让卡片照常挂载：所有控件因为 writable=false 而禁用，写入路径抛一句人话。
*/
const READ_ONLY_SNAPSHOT = {
	value: {},
	writable: false
};
function createReadOnlyScope() {
	return {
		getSnapshot: () => READ_ONLY_SNAPSHOT,
		subscribe: () => () => {},
		set: async () => {
			throw new Error("配置表单不可用：这个插件没有在当前 DSH 上激活。");
		}
	};
}
function usableFormScope(candidate) {
	if (!candidate) return void 0;
	if (typeof candidate.getSnapshot !== "function" || typeof candidate.subscribe !== "function" || typeof candidate.set !== "function") {
		console.warn(`[geo-agent-dsh-plugin] 配置表单 scope 形状不符合预期；实际键：${Object.keys(candidate).join(",") || "(无)"}`);
		return;
	}
	return candidate;
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
	/**
	* 宿主插件清单 remote：**必须**通过嵌套 inject 取，不能直接读 ctx.remote。
	*
	* cordis 的 remote 是校验型代理，取一个没注入过的子命名空间会直接抛错（官方
	* dsh-client-ui-plugin-manager 也是把 "remote.pluginInventory" 写进 inject 的）。
	* 但写进顶层 inject 就等于「宿主没有它时整条客户端半体不加载」——那正是我们要
	* 修的那种故障。用嵌套 inject 拿到的是软依赖：拿不到就保持 undefined，卡片照常
	* 注册，运行环境一栏如实写「检测不到」。
	*/
	const inventoryRef = { current: void 0 };
	ctx.inject(["remote.pluginInventory"], (scope) => {
		try {
			const inventory = scope.remote?.pluginInventory;
			if (inventory && typeof inventory.list === "function") inventoryRef.current = inventory;
		} catch {}
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
			const formScope = usableFormScope(scoped.configForms?.get(PROFILE_ENTRY_ID));
			if (!formScope) console.warn(`[geo-agent-dsh-plugin] 宿主未提供「${PROFILE_ENTRY_ID}」的配置表单；卡片以只读方式注册，并在卡片上说明原因。`);
			const scope = formScope ? {
				...formScope,
				getSnapshot: formScope.getSnapshot.bind(formScope),
				subscribe: formScope.subscribe.bind(formScope),
				set: formScope.set.bind(formScope)
			} : createReadOnlyScope();
			const liveSnapshot = () => scope.getSnapshot();
			const subscribeScope = (listener) => scope.subscribe(listener);
			const useLiveSnapshot = () => (0, react.useSyncExternalStore)(subscribeScope, liveSnapshot, liveSnapshot);
			const useReadOnlySnapshot = () => READ_ONLY_SNAPSHOT;
			const useSnapshot = formScope ? useLiveSnapshot : useReadOnlySnapshot;
			const credentialRemote = (() => {
				try {
					return scoped.remote?.credentials;
				} catch {
					return;
				}
			})();
			/**
			* 运行环境探测：读宿主自己的插件清单（软依赖）。
			*
			* 拿不到清单时返回空对象，卡片按 unknown 处理 —— 「探测不到」不等于「一切
			* 正常」，这两件事在版本问题上必须分开。
			*
			* 刻意不看 managementAvailable：它只表示这个 profile 能不能装/卸插件，而我们
			* 只读激活状态。要求它为 true 会把「能读但不可管理」的宿主（桌面应用自己管的
			* profile 就是这样）误判成探测不到。
			*/
			const runtimeProbe = async () => {
				try {
					const inventory = inventoryRef.current;
					if (!inventory || typeof inventory.list !== "function") return {};
					const result = await inventory.list();
					const value = result?.ok === true ? result.value : void 0;
					if (!value || !Array.isArray(value.entries)) return {};
					return { entries: value.entries };
				} catch {
					return {};
				}
			};
			const injected = () => ({
				scope,
				useSnapshot,
				t,
				credentials: credentialRemote,
				sessions: sessionsRef.current,
				runtimeProbe,
				hasConfigForm: formScope !== void 0
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