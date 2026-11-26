import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("undo", {
		description:
			"Undo the last user message: rewinds to before it and restores it to the editor for editing/resubmitting",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Cannot undo while pi is still responding", "warning");
				return;
			}

			const branch = ctx.sessionManager.getBranch();
			const lastUser = [...branch]
				.reverse()
				.find(
					(entry) => entry.type === "message" && entry.message.role === "user",
				);

			if (!lastUser) {
				ctx.ui.notify("Nothing to undo", "info");
				return;
			}

			try {
				const { cancelled } = await ctx.navigateTree(lastUser.id);
				if (!cancelled) {
					ctx.ui.notify("Undid last message — edit & resubmit", "info");
				}
			} catch (err) {
				ctx.ui.notify(
					`Undo failed: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});
}
