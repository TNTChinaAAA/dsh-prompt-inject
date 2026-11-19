/** DSH 提示词注入插件 client 半边。
 *
 * 在会话头部操作区（`conversation.session.header.actions`）挂「注入提示词」按钮；
 * 点击后在应用内挂一个同源 iframe 浮层（Electron 的 setWindowOpenHandler 会 deny 非 https 的
 * window.open，所以不走新标签页）。浮层标题栏可拖动、默认居中，双击标题栏复位居中。
 */
import * as react from "react";

const PLUGIN_BASE = "/plugins/dsh-prompt-inject";
const CHANNEL_NAME = "dsh-prompt-inject";
/** client sessions 服务的最小形状（只用到当前选中会话）。 */
interface SessionsServiceLike {
	list: { getSnapshot: () => { current?: string } };
}
let sessionsService: SessionsServiceLike | null = null;
/** 回退：从 sessions 服务取当前选定会话 id（alpha.4: getSnapshot().current）。 */
function currentSessionId(): string | undefined {
	if (!sessionsService || !sessionsService.list) return void 0;
	try {
		const id = sessionsService.list.getSnapshot().current;
		if (typeof id === "string" && id) return id;
	} catch {}
}
let bc: BroadcastChannel | null = null;
/** 向管理页面广播当前选中会话（同源跨窗口，页面实时跟随）。 */
function broadcastSession(sessionId: string | undefined): void {
	if (!sessionId) return;
	try {
		if (!bc) bc = new BroadcastChannel(CHANNEL_NAME);
		bc.postMessage({
			type: "session",
			sessionId
		});
	} catch {}
}
/**
* 官方 IconContextInjectionOutline16 的等价内联实现（会话流「上下文注入」行同款）。
* primitives 包不发布到 node_modules（Vite 内联进 web-app bundle），第三方 client 只能
* 从 dist 逐字节提取 SVG path 复刻；viewBox 0 0 16 16，4 条 path，fill=currentColor。
*/
function ContextInjectionIcon(props: { size?: number }) {
	return react.createElement("svg", {
		width: props.size ?? 14,
		height: props.size ?? 14,
		viewBox: "0 0 16 16",
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": true,
		style: {
			color: "var(--dsw-alias-label-primary, #1f2328)",
			flex: "none"
		}
	}, react.createElement("path", {
		fill: "currentColor",
		d: "M11.9512 1.13281C12.401 1.20666 12.8093 1.34164 13.1738 1.60645C13.4282 1.79137 13.6521 2.01609 13.8369 2.27051C14.1574 2.71187 14.2892 3.21614 14.3506 3.78223C14.4105 4.33532 14.4102 5.02658 14.4102 5.87305V10.0273C14.4102 10.8738 14.4105 11.5651 14.3506 12.1182C14.2892 12.6843 14.1574 13.1885 13.8369 13.6299C13.652 13.8843 13.4282 14.109 13.1738 14.2939C12.7324 14.6146 12.2273 14.7462 11.6611 14.8076C11.1081 14.8675 10.4166 14.8672 9.57031 14.8672H6.43164C5.58533 14.8672 4.89387 14.8675 4.34082 14.8076C3.77474 14.7463 3.27046 14.6144 2.8291 14.2939C2.57453 14.109 2.35003 13.8844 2.16504 13.6299C1.84444 13.1885 1.71272 12.6844 1.65137 12.1182C1.59147 11.5651 1.5918 10.8738 1.5918 10.0273V5.87305C1.5918 5.02655 1.59146 4.33533 1.65137 3.78223C1.71272 3.21606 1.84443 2.71191 2.16504 2.27051C2.35003 2.01596 2.57453 1.79141 2.8291 1.60645C3.19332 1.34202 3.60062 1.20669 4.0498 1.13281V2.56445C3.87191 2.61154 3.74906 2.66836 3.65137 2.73926C3.51583 2.83777 3.3964 2.95726 3.29785 3.09277C3.1794 3.25581 3.09143 3.4856 3.04297 3.93262C2.9931 4.39287 2.99219 4.99529 2.99219 5.87305V10.0273C2.99219 10.905 2.99312 11.5075 3.04297 11.9678C3.09142 12.4147 3.17943 12.6446 3.29785 12.8076C3.3964 12.9431 3.51583 13.0626 3.65137 13.1611C3.81441 13.2795 4.04437 13.3676 4.49121 13.416C4.95142 13.4658 5.55411 13.4668 6.43164 13.4668H9.57031C10.4479 13.4668 11.0505 13.4659 11.5107 13.416C11.9576 13.3675 12.1876 13.2796 12.3506 13.1611C12.4861 13.0626 12.6056 12.9431 12.7041 12.8076C12.8224 12.6446 12.9106 12.4146 12.959 11.9678C13.0088 11.5075 13.0098 10.905 13.0098 10.0273V5.87305C13.0098 4.99532 13.0088 4.39286 12.959 3.93262C12.9105 3.48579 12.8225 3.2558 12.7041 3.09277C12.6056 2.95727 12.4861 2.83778 12.3506 2.73926C12.2527 2.66816 12.1296 2.61064 11.9512 2.56348V1.13281Z"
	}), react.createElement("path", {
		fill: "currentColor",
		d: "M9.32227 11.4141H4.95508V10.2148H9.32227V11.4141Z"
	}), react.createElement("path", {
		fill: "currentColor",
		d: "M11.0439 8.90039H4.95508V7.70117H11.0439V8.90039Z"
	}), react.createElement("path", {
		fill: "currentColor",
		d: "M8.59961 3.75781L9.70996 2.64746L10.5586 3.49609L8.49512 5.55957C8.22173 5.83266 7.77816 5.83285 7.50488 5.55957L5.44141 3.49512L6.28906 2.64746L7.40039 3.75781V1.09668H8.59961V3.75781Z"
	}));
}
/** 会话头部按钮的入参。 */
interface InjectButtonProps {
	/** 会话 id；缺省时回退到前端当前选中会话。 */
	sessionId?: string;
}
function InjectButton(props: InjectButtonProps) {
	const [hover, setHover] = react.useState("transparent");
	const [open, setOpen] = react.useState(false);
	const overlayRef = react.useRef<HTMLDivElement | null>(null);
	const frameRef = react.useRef<HTMLIFrameElement | null>(null);
	const sessionId = props.sessionId || currentSessionId();
	react.useEffect(() => {
		broadcastSession(sessionId);
	}, [sessionId]);
	const url = sessionId ? `${PLUGIN_BASE}/page?sessionId=${encodeURIComponent(sessionId)}` : `${PLUGIN_BASE}/page`;
	/* Electron 的 WebContentsView 用 setWindowOpenHandler 把非 https 的 window.open 全部 deny，
	   所以本地 http 页面在新标签打开不会发生；改为在应用内挂一个同源 iframe 浮层。 */
	react.useEffect(() => {
		const host = document.createElement("div");
		host.setAttribute("data-dsh-prompt-inject-overlay", "");
		host.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);";
		const panel = document.createElement("div");
		panel.style.cssText = "width:min(880px,92vw);height:min(860px,92vh);display:flex;flex-direction:column;background:var(--dsw-alias-bg-base,#fff);border-radius:12px;overflow:hidden;box-shadow:0 24px 64px rgba(0,0,0,0.32);color:var(--dsw-alias-label-primary,#1f2328);";
		const bar = document.createElement("div");
		bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-subtle,rgba(0,0,0,0.08));font:600 13px/20px var(--dsw-font-family,system-ui,sans-serif);";
		const title = document.createElement("span");
		title.textContent = "注入提示词";
		const closeBtn = document.createElement("button");
		closeBtn.type = "button";
		closeBtn.title = "关闭";
		closeBtn.setAttribute("aria-label", "关闭");
		closeBtn.textContent = "\u00d7";
		closeBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font:400 18px/20px var(--dsw-font-family,system-ui,sans-serif);padding:0 6px;color:inherit;";
		closeBtn.addEventListener("click", () => setOpen(false));
		const frame = document.createElement("iframe");
		frame.title = "注入提示词";
		frame.style.cssText = "flex:1;width:100%;border:none;background:var(--dsw-alias-bg-base,#fff);";
		bar.appendChild(title);
		bar.appendChild(closeBtn);
		panel.appendChild(bar);
		panel.appendChild(frame);
		host.appendChild(panel);
		/* 拖动：面板默认由 overlay 的 flex 居中；首次按下标题栏时把 panel 切成绝对定位接住当前位置，
		   之后按鼠标偏移移动，并夹在视口内。拖动期间临时关掉 iframe 的 pointer-events，
		   否则指针一进 iframe，父窗口就收不到 mousemove（拖动会「粘住」）。双击标题栏复位居中。 */
		let dragState: { dx: number; dy: number } | null = null;
		const onBarMouseDown = (event: MouseEvent) => {
			if (event.button !== 0 || event.target === closeBtn) return;
			const rect = panel.getBoundingClientRect();
			panel.style.position = "absolute";
			panel.style.left = `${rect.left}px`;
			panel.style.top = `${rect.top}px`;
			dragState = {
				dx: event.clientX - rect.left,
				dy: event.clientY - rect.top
			};
			frame.style.pointerEvents = "none";
			event.preventDefault();
		};
		const onDragMove = (event: MouseEvent) => {
			if (!dragState) return;
			const width = panel.offsetWidth;
			const height = panel.offsetHeight;
			// 允许部分移出视口：横向至少留 160px 可见，纵向标题栏不越过顶边。
			const left = Math.max(160 - width, Math.min(event.clientX - dragState.dx, window.innerWidth - 160));
			const top = Math.max(0, Math.min(event.clientY - dragState.dy, window.innerHeight - 44));
			panel.style.left = `${left}px`;
			panel.style.top = `${top}px`;
		};
		const onDragEnd = () => {
			if (!dragState) return;
			dragState = null;
			frame.style.pointerEvents = "";
		};
		const onBarDoubleClick = () => {
			panel.style.position = "";
			panel.style.left = "";
			panel.style.top = "";
		};
		bar.style.cursor = "move";
		bar.style.userSelect = "none";
		bar.addEventListener("mousedown", onBarMouseDown);
		bar.addEventListener("dblclick", onBarDoubleClick);
		window.addEventListener("mousemove", onDragMove);
		window.addEventListener("mouseup", onDragEnd);
		host.addEventListener("click", (event: MouseEvent) => {
			if (event.target === host) setOpen(false);
		});
		document.body.appendChild(host);
		overlayRef.current = host;
		frameRef.current = frame;
		return () => {
			window.removeEventListener("mousemove", onDragMove);
			window.removeEventListener("mouseup", onDragEnd);
			host.remove();
			overlayRef.current = null;
			frameRef.current = null;
		};
	}, []);
	react.useEffect(() => {
		const host = overlayRef.current;
		if (!host) return;
		if (!open) {
			host.style.display = "none";
			return;
		}
		const frame = frameRef.current;
		if (frame && frame.getAttribute("src") !== url) frame.setAttribute("src", url);
		host.style.display = "flex";
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, url]);
	return react.createElement("button", {
		type: "button",
		title: "注入提示词",
		"aria-label": "注入提示词",
		onClick: () => setOpen((value) => !value),
		onMouseEnter: () => setHover("var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06))"),
		onMouseLeave: () => setHover("transparent"),
		style: {
			display: "inline-flex",
			alignItems: "center",
			gap: 4,
			minHeight: 22,
			padding: "0 6px",
			border: "none",
			borderRadius: 6,
			background: hover,
			color: "var(--dsw-alias-label-primary, #1f2328)",
			cursor: "pointer",
			fontSize: 12,
			fontWeight: 400,
			lineHeight: "22px",
			whiteSpace: "nowrap",
			transition: "background 120ms ease"
		}
	}, react.createElement(ContextInjectionIcon, { size: 14 }), "注入提示词");
}
const name = "dsh-prompt-inject";
const inject: string[] = [
	"slots",
	"sessions",
	"locale",
	"commandUi"
];
function apply(ctx: any): void {
	if (ctx.sessions) sessionsService = ctx.sessions;
	ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
		name: "conversation.session.header.actions",
		id: "prompt-inject",
		order: 50
	}, InjectButton));
}

export { apply, inject, name };
