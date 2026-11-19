#!/usr/bin/env node
/** 构建两侧产物。
 *
 * - host  → lib/host/index.mjs（ESM，Node 侧，直接由 DSH host loader 加载）
 * - client → lib/client/client.js（factory-form CJS，套 DSH 的 window.__ModuleLoader__.load 壳）
 * 两个 .d.ts 是手写的薄壳，与产物一起写出。
 */
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));

/* DSH client-modules 的加载协议：脚本执行时注册一个 factory，factory(require) 返回 exports。
   壳里的 module/exports 是 factory 形式的 CJS 垫片，注入 id 必须等于包名，
   否则 dsh-client-modules 按包名取模块时会找不到注册项。 */
const clientShell = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(pkg.name)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`;
const clientShellEnd = `
		return module.exports;
	}
});
`;

await mkdir(join(root, "lib/host"), { recursive: true });
await mkdir(join(root, "lib/client"), { recursive: true });

await build({
	entryPoints: [join(root, "src/host/index.ts")],
	bundle: true,
	platform: "node",
	format: "esm",
	target: "node22",
	outfile: join(root, "lib/host/index.mjs"),
	external: ["node:*"],
	logLevel: "info"
});

await build({
	entryPoints: [join(root, "src/client/index.tsx")],
	bundle: true,
	platform: "browser",
	format: "cjs",
	target: "es2022",
	outfile: join(root, "lib/client/client.js"),
	external: ["react"],
	banner: { js: clientShell },
	footer: { js: clientShellEnd },
	logLevel: "info"
});

const dts = `declare const name = "dsh-prompt-inject";
declare const inject: string[];
declare function apply(ctx: any): void;
export { apply, inject, name };
`;
await writeFile(join(root, "lib/host/index.d.mts"), dts, "utf8");
await writeFile(join(root, "lib/client/client.d.ts"), dts, "utf8");

console.log(`built ${pkg.name}@${pkg.version}`);
