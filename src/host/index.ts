/** DSH 提示词注入插件 host 半边。
 *
 * - 管理提示词：`/plugins/dsh-prompt-inject/prompts`（GET/POST）与 `/prompts/{id}`（PUT/DELETE）
 * - 一次性注入：`/inject`（窗口判据）；无条件注入：`/send`（不落盘，force 标记）
 * - 管理页：`/page`；外观偏好：`/theme`
 * - 注入管线：监听 llm/stream、tools/post-execute、agent/pre-step，在模型 step 前追加插件 user 消息。
 */
import { PANEL_PAGE_HTML } from "./page.ts";
import { getStepConfig, setStepConfig, clearPromptConfig, loadPrompts, savePrompts, newId } from "./store.ts";

const PLUGIN_BASE = "/plugins/dsh-prompt-inject";
const INJECT_TTL_MS = 6e5;
function sendJson(res, status, body) {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}
async function readBody(req) {
	const chunks = [];
	for await (const chunk of req) chunks.push(String(chunk));
	try {
		return JSON.parse(chunks.join("") || "{}");
	} catch {
		return {};
	}
}
/** 从 req.url 解析 /prompts/{id} 的 id（去掉 /prompts/ 前缀后的首段）。无则返回 ''。 */
function promptIdFromUrl(req) {
	try {
		const pathname = new URL(req.url, "http://localhost").pathname;
		const base = `${PLUGIN_BASE}/prompts/`;
		if (!pathname.startsWith(base)) return "";
		const id = pathname.slice(base.length).split("/")[0] || "";
		return decodeURIComponent(id);
	} catch {
		return "";
	}
}
const name = "dsh-prompt-inject";
const inject = ["webServer", "settings"];
/** 读取 dsh 外观偏好（theme 命名空间 ui-theme，preference: light|dark|system）。失败返回 system。 */
function readThemePreference(ctx) {
	try {
		const settings = ctx.settings;
		if (!settings || typeof settings.scope !== "function") return "system";
		const scope = settings.scope("ui-theme");
		if (!scope || typeof scope.get !== "function") return "system";
		const pref = scope.get()?.preference;
		return pref === "light" || pref === "dark" || pref === "system" ? pref : "system";
	} catch {
		return "system";
	}
}
function apply(ctx) {
	const pendingInjections = /* @__PURE__ */ new Map();
	const stepwiseHits = /* @__PURE__ */ new Map();
	const currentTurn = /* @__PURE__ */ new Map();
	const windowPresent = /* @__PURE__ */ new Map();
	/** 提示词是否还在窗口中：即将发给模型的 messages 里是否仍包含该提示词原文。 */
	function isStillInWindow(messages, text) {
		try {
			if (!Array.isArray(messages)) return false;
			for (const m of messages) {
				if (!m || !Array.isArray(m.content)) continue;
				for (const b of m.content) if (b && (b.type === "text" || b.type === "reasoning") && typeof b.text === "string" && b.text.includes(text)) return true;
			}
		} catch {}
		return false;
	}
	/** 构造插件 user 消息（对齐 dsh-mnemon createPluginMessage）。 */
	function makeUserMessage(text) {
		return {
			id: `${name}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
			role: "user",
			content: [{
				type: "text",
				text
			}],
			source: {
				kind: `plugin:${name}`,
				form: "instructions"
			}
		};
	}
	/** 逐步条件命中 → 入队（消费时再看窗口）。仅取【该会话】开启逐步注入且条件含 cond 的提示词。 */
	function queueStepwise(sessionId, cond, turn) {
		if (!sessionId) return;
		if (typeof turn !== "number") {
			try {
				ctx.logger?.warn?.(`[dsh-prompt-inject] 逐步命中 ${sessionId} @ ${cond} 但 turn 缺失，丢弃`);
			} catch {}
			return;
		}
		const items = loadPrompts().filter((it) => {
			const cfg = getStepConfig(sessionId, it.id);
			return cfg.stepwise === true && Array.isArray(cfg.conditions) && cfg.conditions.includes(cond);
		});
		if (items.length === 0) return;
		const existing = stepwiseHits.get(sessionId);
		const merged = existing ? [...existing.items, ...items] : [...items];
		const seen = /* @__PURE__ */ new Set();
		const dedup = merged.filter((it) => {
			if (seen.has(it.id)) return false;
			seen.add(it.id);
			return true;
		});
		if (existing) clearTimeout(existing.timer);
		stepwiseHits.set(sessionId, {
			items: dedup,
			turn,
			timer: setTimeout(() => {
				stepwiseHits.delete(sessionId);
			}, INJECT_TTL_MS)
		});
		try {
			ctx.logger?.info?.(`[dsh-prompt-inject] 条件命中 ${sessionId} @ ${cond} (turn=${turn})，${items.length} 条入队`);
		} catch {}
	}
	ctx.on("llm/stream", async function* (options, next) {
		const sessionId = options?.sessionId;
		const isSessionStep = sessionId && !options?.purpose;
		const sid = sessionId ? String(sessionId) : "";
		if (isSessionStep && Array.isArray(options?.messages)) try {
			const present = /* @__PURE__ */ new Set();
			for (const it of loadPrompts()) if (getStepConfig(sid, it.id).stepwise === true && isStillInWindow(options.messages, it.text)) present.add(it.id);
			windowPresent.set(sid, present);
		} catch {}
		let thoughtEnded = false;
		for await (const chunk of next()) {
			if (isSessionStep && !thoughtEnded && chunk && typeof chunk === "object") {
				if (chunk.type === "block-end" && (chunk.blockType === "reasoning" || chunk.block?.blockType === "reasoning")) thoughtEnded = true;
				else if (chunk.type === "text-delta") thoughtEnded = true;
				if (thoughtEnded) queueStepwise(sid, "thinking-end", currentTurn.get(sid));
			}
			yield chunk;
		}
	});
	ctx.on("tools/post-execute", async (exec, _result, next) => {
		if (exec?.name) queueStepwise(exec?.agent?.id, `tool-post:${exec.name}`, currentTurn.get(String(exec?.agent?.id)));
		return next();
	});
	ctx.on("agent/turn-stopping", async (payload) => {
		const sessionId = payload?.agent?.id;
		if (!sessionId) return;
		const sw = stepwiseHits.get(sessionId);
		if (sw && sw.turn === payload?.turn) {
			clearTimeout(sw.timer);
			stepwiseHits.delete(sessionId);
			try {
				ctx.logger?.info?.(`[dsh-prompt-inject] 本轮结束丢弃 ${sessionId} (turn=${sw.turn})，${sw.items.length} 条`);
			} catch {}
		}
	});
	ctx.on("agent/pre-step", async (payload, next) => {
		try {
			const agentId = payload?.agent?.id;
			if (!agentId) return next();
			const turn = typeof payload?.turn === "number" ? payload.turn : void 0;
			const prevTurn = currentTurn.get(String(agentId));
			if (turn !== void 0 && prevTurn !== turn) queueStepwise(String(agentId), "turn-start", turn);
			if (turn !== void 0) currentTurn.set(String(agentId), turn);
			const pending = pendingInjections.get(String(agentId));
			let sw = stepwiseHits.get(String(agentId));
			if (sw && turn !== void 0 && sw.turn !== turn) {
				clearTimeout(sw.timer);
				stepwiseHits.delete(String(agentId));
				try {
					ctx.logger?.info?.(`[dsh-prompt-inject] 过期丢弃 ${agentId} (排队 turn=${sw.turn} ≠ 当前 turn=${turn})，${sw.items.length} 条`);
				} catch {}
				sw = void 0;
			}
			if (!pending && !sw) return next();
			if (pending) clearTimeout(pending.timer);
			if (sw) clearTimeout(sw.timer);
			pendingInjections.delete(String(agentId));
			stepwiseHits.delete(String(agentId));
			const decision = await next();
			if (!decision || decision.kind !== "enter") return decision;
			const messages = Array.isArray(decision.messages) ? decision.messages : [];
			const present = windowPresent.get(String(agentId));
			const inWindow = (it) => {
				if (present && present.has(it.id)) return true;
				return isStillInWindow(messages, it.text);
			};
			let injected = 0;
			// 一次性队列：带 force 标记的（从「发送」进来的）无条件注入，其余沿用窗口判据。
			if (pending && (pending.item.force === true || !inWindow(pending.item))) {
				messages.push(makeUserMessage(pending.item.text));
				injected += 1;
			}
			if (sw) {
				for (const it of sw.items) if (getStepConfig(String(agentId), it.id).forceInject === true || !inWindow(it)) {
					messages.push(makeUserMessage(it.text));
					injected += 1;
				}
			}
			if (injected > 0) try {
				ctx.logger?.info?.(`[dsh-prompt-inject] 已注入 ${agentId}（${injected} 条）`);
			} catch {}
			return {
				kind: "enter",
				messages
			};
		} catch (err) {
			try {
				ctx.logger?.warn?.(`[dsh-prompt-inject] 注入监听器异常: ${err?.message ?? err}`);
			} catch {}
			return next();
		}
	});
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.webServer;
		const disposers = [];
		const safeRegister = (route) => {
			try {
				disposers.push(webServer.register(route));
			} catch (err) {
				try {
					webCtx.logger?.warn?.(`[dsh-prompt-inject] 路由注册失败 ${route.kind} ${route.path}: ${err?.message ?? err}`);
				} catch {}
			}
		};
		safeRegister({
			kind: "exact",
			path: `${PLUGIN_BASE}/prompts`,
			handler: async (req, res) => {
				try {
					if (req.method === "GET") {
						let sessionId;
						try {
							sessionId = new URL(req.url, "http://localhost").searchParams.get("sessionId") || void 0;
						} catch {}
						const items = loadPrompts().map((it) => {
							if (!sessionId) return it;
							const cfg = getStepConfig(sessionId, it.id);
							return {
								...it,
								stepwise: cfg.stepwise,
								stepwiseConditions: cfg.conditions,
								forceInject: cfg.forceInject
							};
						});
						items.sort((a, b) => {
							const p = (b.pinned === true ? 1 : 0) - (a.pinned === true ? 1 : 0);
							if (p !== 0) return p;
							return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
						});
						sendJson(res, 200, {
							ok: true,
							items
						});
						return;
					}
					if (req.method === "POST") {
						const body = await readBody(req);
						const text = typeof body.text === "string" ? body.text.trim() : "";
						if (!text) {
							sendJson(res, 400, {
								ok: false,
								error: "text 不能为空"
							});
							return;
						}
						const items = loadPrompts();
						const item = {
							id: newId(),
							text,
							updatedAt: (/* @__PURE__ */ new Date()).toISOString()
						};
						items.push(item);
						savePrompts(items);
						sendJson(res, 200, {
							ok: true,
							item
						});
						return;
					}
					res.writeHead(405);
					res.end();
				} catch (err) {
					sendJson(res, 500, {
						ok: false,
						error: String(err?.message || err)
					});
				}
			}
		});
		safeRegister({
			kind: "prefix",
			path: `${PLUGIN_BASE}/prompts`,
			handler: async (req, res) => {
				if (req.method !== "PUT" && req.method !== "DELETE") {
					res.writeHead(405);
					res.end();
					return;
				}
				try {
					const id = promptIdFromUrl(req);
					if (!id) {
						sendJson(res, 400, {
							ok: false,
							error: "缺少提示词 id"
						});
						return;
					}
					const items = loadPrompts();
					const idx = items.findIndex((it) => it.id === id);
					if (idx < 0) {
						sendJson(res, 404, {
							ok: false,
							error: "提示词不存在"
						});
						return;
					}
					if (req.method === "DELETE") {
						savePrompts(items.filter((it) => it.id !== id));
						clearPromptConfig(id);
						sendJson(res, 200, { ok: true });
						return;
					}
					const body = await readBody(req);
					const text = typeof body.text === "string" ? body.text.trim() : "";
					if (!text) {
						sendJson(res, 400, {
							ok: false,
							error: "text 不能为空"
						});
						return;
					}
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : void 0;
					const stepwise = typeof body.stepwise === "boolean" ? body.stepwise : false;
					const forceInject = typeof body.forceInject === "boolean" ? body.forceInject : false;
					const stepwiseConditions = Array.isArray(body.stepwiseConditions) ? body.stepwiseConditions.filter((s) => typeof s === "string") : [];
					const pinned = typeof body.pinned === "boolean" ? body.pinned : items[idx].pinned === true;
					const textChanged = text !== items[idx].text;
					items[idx] = {
						...items[idx],
						text,
						pinned,
						updatedAt: textChanged ? (/* @__PURE__ */ new Date()).toISOString() : items[idx].updatedAt
					};
					savePrompts(items);
					setStepConfig(sessionId, id, {
						stepwise,
						conditions: stepwiseConditions,
						forceInject
					});
					const cfg = getStepConfig(sessionId, id);
					sendJson(res, 200, {
						ok: true,
						item: {
							...items[idx],
							stepwise: cfg.stepwise,
							stepwiseConditions: cfg.conditions,
							forceInject: cfg.forceInject
						}
					});
				} catch (err) {
					sendJson(res, 500, {
						ok: false,
						error: String(err?.message || err)
					});
				}
			}
		});
		safeRegister({
			kind: "exact",
			path: `${PLUGIN_BASE}/inject`,
			handler: async (req, res) => {
				if (req.method !== "POST") {
					res.writeHead(405);
					res.end();
					return;
				}
				try {
					const body = await readBody(req);
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const promptId = typeof body.promptId === "string" ? body.promptId : "";
					if (!sessionId) {
						sendJson(res, 400, {
							ok: false,
							error: "sessionId 不能为空"
						});
						return;
					}
					if (!promptId) {
						sendJson(res, 400, {
							ok: false,
							error: "promptId 不能为空"
						});
						return;
					}
					const item = loadPrompts().find((it) => it.id === promptId);
					if (!item) {
						sendJson(res, 404, {
							ok: false,
							error: "提示词不存在"
						});
						return;
					}
					const existing = pendingInjections.get(sessionId);
					if (existing) clearTimeout(existing.timer);
					pendingInjections.set(sessionId, {
						item,
						timer: setTimeout(() => {
							const cur = pendingInjections.get(sessionId);
							if (cur && cur.item.id === item.id) pendingInjections.delete(sessionId);
						}, INJECT_TTL_MS)
					});
					try {
						ctx.logger?.info?.(`[dsh-prompt-inject] 已排队 ${sessionId} -> "${item.text}"`);
					} catch {}
					sendJson(res, 200, {
						ok: true,
						queued: true,
						sessionId
					});
				} catch (err) {
					sendJson(res, 500, {
						ok: false,
						error: String(err?.message || err)
					});
				}
			}
		});
		safeRegister({
			kind: "exact",
			path: `${PLUGIN_BASE}/send`,
			handler: async (req, res) => {
				if (req.method !== "POST") {
					res.writeHead(405);
					res.end();
					return;
				}
				try {
					const body = await readBody(req);
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const text = typeof body.text === "string" ? body.text.trim() : "";
					if (!sessionId) {
						sendJson(res, 400, { ok: false, error: "sessionId 不能为空" });
						return;
					}
					if (!text) {
						sendJson(res, 400, { ok: false, error: "text 不能为空" });
						return;
					}
					// 「发送」= 一次性无条件注入：只进内存队列，不写 prompts.json（词条不会留在列表里）。
					// force 标记让 pre-step 跳过窗口判据，无论该文本是否已在模型窗口内都注入一次。
					const item = {
						id: `send_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
						text,
						updatedAt: (new Date()).toISOString(),
						force: true
					};
					const existing = pendingInjections.get(sessionId);
					if (existing) clearTimeout(existing.timer);
					pendingInjections.set(sessionId, {
						item,
						timer: setTimeout(() => {
							const cur = pendingInjections.get(sessionId);
							if (cur && cur.item.id === item.id) pendingInjections.delete(sessionId);
						}, INJECT_TTL_MS)
					});
					try {
						ctx.logger?.info?.(`[dsh-prompt-inject] 已排队无条件注入 ${sessionId} -> "${item.text}"`);
					} catch {}
					sendJson(res, 200, { ok: true, queued: true, force: true, sessionId });
				} catch (err) {
					sendJson(res, 500, { ok: false, error: String(err?.message || err) });
				}
			}
		});
		safeRegister({
			kind: "exact",
			path: `${PLUGIN_BASE}/theme`,
			handler: (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405);
					res.end();
					return;
				}
				sendJson(res, 200, {
					ok: true,
					preference: readThemePreference(ctx)
				});
			}
		});
		safeRegister({
			kind: "exact",
			path: `${PLUGIN_BASE}/page`,
			handler: (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405);
					res.end();
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(PANEL_PAGE_HTML);
			}
		});
		return () => {
			for (const d of disposers) try {
				d();
			} catch {}
		};
	});
}

export { apply, inject, name };
