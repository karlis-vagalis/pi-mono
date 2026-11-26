import { unlink } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerCommand("delete", {
		description: "Delete current session and start a fresh one",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				const choice = await ctx.ui.select("Delete session?", [
					"Yes, delete it",
					"No",
				]);
				if (choice !== "Yes, delete it") return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();

			const { cancelled } = await ctx.newSession();

			if (!cancelled && sessionFile) {
				try {
					await unlink(sessionFile);
				} catch {
					// Session file may already be gone or locked
				}
			}
		},
	});
}
