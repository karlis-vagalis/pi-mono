import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	// Add exit command
	pi.registerCommand("exit", {
		description: "Exit pi",
		handler: async (_args, ctx) => {
			ctx.shutdown();
		},
	});

	// Exit on plain "exit" message (not a slash command)
	pi.on("input", async (event, ctx) => {
		if (event.text.trim().toLowerCase() === "exit") {
			ctx.shutdown();
			return { action: "handled" as const };
		}
	});
}
