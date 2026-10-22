import type { AppInfo } from "./schema.ts";

function escapeHtml(value: string): string {
	const entities: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#39;",
	};
	return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

function formatExpiry(expiresAt: AppInfo["expiresAt"]): string {
	if (expiresAt === null) return "NO EXPIRY";
	const minutes = Math.ceil((expiresAt - Date.now()) / 60_000);
	if (minutes < 1) return "EXPIRES IN <1M";
	if (minutes < 60) return `EXPIRES IN ${minutes}M`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24)
		return `EXPIRES IN ${hours}H${minutes % 60 ? ` ${minutes % 60}M` : ""}`;
	return `EXPIRES IN ${Math.floor(hours / 24)}D${hours % 24 ? ` ${hours % 24}H` : ""}`;
}

// Self-contained app directory with light, dark, and system appearance modes.
export function renderApps(apps: readonly AppInfo[]): string {
	const cards = apps
		.map((app) => {
			const deployment = app.deployment;
			const ready = deployment.status === "ready";
			const title = ready ? deployment.manifest.title : app.id;
			const description = ready
				? deployment.manifest.description
				: "Build failed. Use flare_get in Pi to inspect the error.";
			const status = ready
				? `${deployment.manifest.type === "static" ? "STATIC" : deployment.manifest.objects.length ? "DURABLE" : "WORKER"} · READY`
				: deployment.servingRevision
					? "BUILD ERROR · PREVIOUS VERSION LIVE"
					: "BUILD ERROR · UNAVAILABLE";
			return `<a class="artifact" href="${escapeHtml(app.url)}"><div class="artifact-meta"><span class="artifact-id">${escapeHtml(app.id)}</span><span class="open-label">Open <span aria-hidden="true">↗</span></span></div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p><div class="session">${status}</div><div class="expiry">${escapeHtml(formatExpiry(app.expiresAt))}</div></a>`;
		})
		.join("\n");
	return `<!doctype html><html lang="en" data-theme="system"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>Flare Apps</title><script>try{const theme=localStorage.getItem('flare-theme');if(['light','dark','system'].includes(theme))document.documentElement.dataset.theme=theme}catch{}</script><style>
:root{color-scheme:dark;--canvas:#0a0a0b;--surface:#111112;--raised:#171719;--text:#fafafa;--muted:rgb(255 255 255 / 63%);--subtle:rgb(255 255 255 / 42%);--border:#1e1e20;--border-strong:#2b2b2e;--accent:#da5c2b;--accent-hover:#ef7040;--mono:ui-monospace,"SFMono-Regular",Consolas,monospace;--sans:Geist,Arial,sans-serif}html[data-theme="light"]{color-scheme:light;--canvas:#f8f8f7;--surface:#fff;--raised:#f1f1ef;--text:#111113;--muted:#626167;--subtle:#86848a;--border:#dedde0;--border-strong:#c9c7cb;--accent:#c44d20;--accent-hover:#a83f19} @media(prefers-color-scheme:light){html[data-theme="system"]{color-scheme:light;--canvas:#f8f8f7;--surface:#fff;--raised:#f1f1ef;--text:#111113;--muted:#626167;--subtle:#86848a;--border:#dedde0;--border-strong:#c9c7cb;--accent:#c44d20;--accent-hover:#a83f19}}*{box-sizing:border-box}html,body{min-height:100%;scrollbar-gutter:stable}body{margin:0;background:var(--canvas);color:var(--text);font:400 16px/1.5 var(--sans);transition:background-color 150ms,color 150ms}.topbar{height:64px;border-bottom:1px solid var(--border);display:flex;align-items:center}.topbar-inner{width:min(1240px,100%);padding:0 28px;margin:auto;display:flex;align-items:center;justify-content:space-between}.brand{font-size:14px;font-weight:500;letter-spacing:-.02em}.brand-mark{color:var(--accent);margin-right:9px}.theme-switch{display:flex;gap:2px;padding:3px;border:1px solid var(--border-strong);border-radius:6px;background:var(--surface)}.theme-switch button{border:0;border-radius:4px;background:transparent;color:var(--muted);padding:6px 9px;font:500 12px/1 var(--sans);cursor:pointer}.theme-switch button[aria-pressed="true"]{background:var(--raised);color:var(--text)}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.wrap{width:min(1240px,100%);padding:70px 28px 96px;margin:auto}.eyebrow{font:500 11px/1.4 var(--mono);letter-spacing:.07em;text-transform:uppercase;color:var(--subtle)}h1{font-size:clamp(42px,6vw,64px);font-weight:500;line-height:1;letter-spacing:-.03em;margin:16px 0 13px}.intro{color:var(--muted);max-width:65ch;margin:0}.summary{margin:34px 0 14px;padding:12px 0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:16px;color:var(--subtle);font:11px/1.5 var(--mono);letter-spacing:.035em;text-transform:uppercase}.summary strong{color:var(--text);font-weight:500}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr));gap:12px}.artifact{min-width:0;padding:19px 20px 17px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:inherit;text-decoration:none;transition:border-color 150ms,background-color 150ms}.artifact:hover{border-color:var(--border-strong);background:var(--raised)}.artifact-meta{display:flex;justify-content:space-between;gap:12px;align-items:center}.artifact-id,.session{font:11px/1.4 var(--mono);letter-spacing:.035em;color:var(--subtle)}.artifact-id{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.open-label{font-size:12px;color:var(--accent);flex-shrink:0;white-space:nowrap}.artifact h2{font-size:20px;line-height:1.25;font-weight:500;letter-spacing:-.015em;margin:17px 0 7px;overflow-wrap:anywhere}.artifact p{margin:0;color:var(--muted);font-size:14px;line-height:1.55;min-height:44px;overflow-wrap:anywhere}.session{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:20px;padding-top:12px;border-top:1px solid var(--border)}.expiry{margin-top:6px;color:var(--accent);font:11px/1.4 var(--mono);letter-spacing:.035em}.empty{padding:22px 0;border-bottom:1px solid var(--border);color:var(--muted)}@media(max-width:520px){.topbar-inner{padding:0 18px}.wrap{padding:50px 18px 72px}.summary{font-size:10px}}
</style></head><body><header class="topbar"><div class="topbar-inner"><div class="brand"><span class="brand-mark" aria-hidden="true">▰</span>Flare</div><nav class="theme-switch" aria-label="Color theme"><button type="button" data-mode="light" aria-pressed="false">Light</button><button type="button" data-mode="dark" aria-pressed="false">Dark</button><button type="button" data-mode="system" aria-pressed="true">System</button></nav></div></header><main class="wrap"><div class="eyebrow">Shared workspace / local microapps</div><h1>Apps</h1><p class="intro">A single place to open apps created by your Pi sessions.</p><div class="summary"><span>Available apps</span><span><strong>${apps.length}</strong>&nbsp; ${apps.length === 1 ? "item" : "items"}</span></div>${cards ? `<section class="grid" aria-label="Available apps">${cards}</section>` : '<div class="empty">No apps yet. Use flare_create in Pi to create one.</div>'}</main><script>const root=document.documentElement;const buttons=[...document.querySelectorAll('[data-mode]')];function syncTheme(){const theme=root.dataset.theme||'system';buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.mode===theme)))}buttons.forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.mode;root.dataset.theme=mode;try{localStorage.setItem('flare-theme',mode)}catch{}syncTheme()}));syncTheme();</script></body></html>`;
}
