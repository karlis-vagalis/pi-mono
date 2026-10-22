import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";

const workers = new Map();

async function published(env, id) {
	const response = await fetch(`${env.REGISTRY}/bundle/${id}`, {
		headers: { authorization: `Bearer ${env.TOKEN}` },
	});
	if (!response.ok)
		throw Object.assign(new Error(`App unavailable (${response.status})`), {
			status: response.status,
		});
	return response.json();
}

function load(env, ctx, id, app) {
	return env.LOADER.get(`${id}:${app.revision}`, () => ({
		compatibilityDate: "2026-01-01",
		mainModule: "worker.js",
		modules: { "worker.js": app.source },
		limits: { cpuMs: 50, subRequests: 50 },
		env: {
			...app.manifest.vars,
			ASSETS: ctx.exports.Assets({ props: { id } }),
			OBJECTS: ctx.exports.Objects({ props: { id } }),
		},
	}));
}

export class Assets extends WorkerEntrypoint {
	async fetch(request) {
		const url = new URL(request.url);
		return fetch(
			`${this.env.REGISTRY}/assets/${this.ctx.props.id}${url.pathname}${url.search}`,
			{
				method: request.method,
				headers: { authorization: `Bearer ${this.env.TOKEN}` },
			},
		);
	}
}

// A scoped Fetcher capability, not a full DurableObjectNamespace.
export class Objects extends WorkerEntrypoint {
	fetch(request) {
		const url = new URL(request.url);
		const [, className, name, ...path] = url.pathname.split("/");
		if (!className || !name || !/^[A-Za-z0-9_-]{1,128}$/.test(name))
			return new Response("Use /ClassName/object-name/path", { status: 400 });
		url.pathname = `/${path.join("/")}`;
		const forwarded = new Request(url, request);
		forwarded.headers.set("x-flare-class", className);
		forwarded.headers.set("x-flare-name", name);
		return this.env.SUPERVISOR.getByName(this.ctx.props.id).fetch(forwarded);
	}
}

export class Supervisor extends DurableObject {
	async fetch(request) {
		const facet = await this.ctx.blockConcurrencyWhile(async () => {
			const id = this.ctx.id.name;
			const app = await published(this.env, id);
			const className = request.headers.get("x-flare-class");
			if (
				app.manifest.type !== "worker" ||
				!app.manifest.objects.includes(className)
			)
				throw new Error("Durable class is not declared in app.json objects");
			if (this.revision !== app.revision) {
				for (const name of this.names ?? [])
					this.ctx.facets.abort(name, "App code reloaded");
				this.worker?.dispose();
				this.worker = load(this.env, this.ctx, id, app);
				this.names = new Set();
				this.revision = app.revision;
			}
			const name = request.headers.get("x-flare-name");
			const key = JSON.stringify([className, name]);
			this.names.add(key);
			return this.ctx.facets.get(key, () => ({
				class: this.worker.getDurableObjectClass(className),
				id: name,
			}));
		});
		const forwarded = new Request(request);
		forwarded.headers.delete("x-flare-class");
		forwarded.headers.delete("x-flare-name");
		return facet.fetch(forwarded);
	}
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/_flare/health") return new Response("pi-flare");
		if (url.pathname === "/") {
			if (request.method !== "GET" && request.method !== "HEAD")
				return new Response("Method not allowed", {
					status: 405,
					headers: { Allow: "GET, HEAD" },
				});
			const page = await fetch(`${env.REGISTRY}/directory`, {
				method: request.method,
				headers: { authorization: `Bearer ${env.TOKEN}` },
			});
			return new Response(request.method === "HEAD" ? null : page.body, {
				status: page.status,
				headers: page.headers,
			});
		}
		const match = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(\/.*)?$/.exec(url.pathname);
		if (!match) return new Response("Not found", { status: 404 });
		const [, id, path] = match;
		if (!path) {
			url.pathname += "/";
			return Response.redirect(url, 308);
		}
		url.pathname = path;
		try {
			const app = await published(env, id);
			const forwarded = new Request(url, request);
			const assets = ctx.exports.Assets({ props: { id } });
			if (app.manifest.type === "static") {
				workers.get(id)?.worker.dispose();
				workers.delete(id);
				return assets.fetch(forwarded);
			}
			let cached = workers.get(id);
			if (cached?.revision !== app.revision) {
				cached?.worker.dispose();
				cached = { revision: app.revision, worker: load(env, ctx, id, app) };
				workers.set(id, cached);
			}
			return await cached.worker.getEntrypoint().fetch(forwarded);
		} catch (error) {
			if (error.status === 404) {
				workers.get(id)?.worker.dispose();
				workers.delete(id);
				return new Response("Not found", { status: 404 });
			}
			console.error(`Flare ${id}:`, error);
			return new Response(
				"App unavailable; inspect flare_get and runtime.log",
				{
					status: 503,
				},
			);
		}
	},
};
