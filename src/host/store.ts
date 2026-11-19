/** 提示词存储与会话作用域逐步注入配置。
 *
 * 提示词正文/置顶持久化到 `$DSH_HOME/dsh-prompt-inject/prompts.json`；
 * 逐步（条件）注入配置是纯运行期内存态，按会话隔离，重启即空。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 单条提示词的逐步（条件）注入配置。 */
export interface StepConfig {
	/** 是否开启条件注入。 */
	stepwise: boolean;
	/** 条件表达式列表，如 `turn-start` / `thinking-end` / `tool-post:grep`。 */
	conditions: string[];
	/** 命中条件后是否无视窗口判据强制注入。 */
	forceInject: boolean;
}

/** prompts.json 里的一条提示词。 */
export interface PromptItem {
	id: string;
	text: string;
	updatedAt: string;
	pinned?: boolean;
}

/** 缺省逐步配置（会话维度查不到时返回：全部关闭）。 */
const DEFAULT_STEP_CONFIG: StepConfig = {
	stepwise: false,
	conditions: [],
	forceInject: false
};

/**
 * 会话作用域的逐步注入配置：sessionId -> (promptId -> StepConfig)。
 * 纯运行期内存储（apply 作用域），重启即空 → 满足「重启/启动逐步注入全关」。
 */
const sessionStepConfig = new Map<string, Map<string, StepConfig>>();

/** 取某会话某提示词的逐步配置（缺省全关）。 */
function getStepConfig(sessionId: string | undefined, promptId: string): StepConfig {
	if (!sessionId) return { ...DEFAULT_STEP_CONFIG };
	const m = sessionStepConfig.get(sessionId);
	const c = m?.get(promptId);
	return c ? { ...c } : { ...DEFAULT_STEP_CONFIG };
}

/** 写入某会话某提示词的逐步配置（不存在的子 Map 自动创建）。 */
function setStepConfig(sessionId: string | undefined, promptId: string, cfg: StepConfig): void {
	if (!sessionId) return;
	let m = sessionStepConfig.get(sessionId);
	if (!m) {
		m = new Map<string, StepConfig>();
		sessionStepConfig.set(sessionId, m);
	}
	m.set(promptId, { ...cfg });
}

/** 删除某条提示词时，清掉所有会话里它的逐步配置（配置按会话分散存放）。 */
function clearPromptConfig(promptId: string): void {
	for (const m of sessionStepConfig.values()) m.delete(promptId);
}

/** 插件自有数据目录：`$DSH_HOME/dsh-prompt-inject`。 */
function resolveDataDir(): string {
	const home = process.env.DSH_HOME || join(homedir(), ".dsh");
	return join(home, "dsh-prompt-inject");
}

/** 提示词正文落盘文件。 */
function resolvePromptsFile(): string {
	return join(resolveDataDir(), "prompts.json");
}

let cache: PromptItem[] | null = null;

/** 读提示词列表（带简单内存缓存，避免每次请求都读盘）。 */
function loadPrompts(): PromptItem[] {
	if (cache) return cache;
	const file = resolvePromptsFile();
	if (!existsSync(file)) {
		cache = [];
		return cache;
	}
	try {
		const raw = readFileSync(file, "utf8");
		const parsed: unknown = JSON.parse(raw);
		cache = Array.isArray(parsed) ? (parsed as PromptItem[]) : [];
	} catch {
		cache = [];
	}
	return cache;
}

/** 写回提示词列表（先建目录，再写盘并更新缓存）。 */
function savePrompts(items: PromptItem[]): void {
	const dir = resolveDataDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const file = resolvePromptsFile();
	writeFileSync(file, JSON.stringify(items, null, 2), "utf8");
	cache = items;
}

/** 生成稳定 id（时间戳 + 随机后缀，避免碰撞）。 */
function newId(): string {
	return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export { getStepConfig, setStepConfig, clearPromptConfig, resolveDataDir, resolvePromptsFile, loadPrompts, savePrompts, newId };
