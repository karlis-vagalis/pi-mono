import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// `find` whose first path argument is the filesystem root `/`.
// Matches `find /`, `find / -name foo`, `sudo find /`; NOT `find ./` or `find /home`.
const ROOT_FIND = /\bfind\s+\/(?:\s|$|[;&|])/i;

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName === "bash") {
			const command = event.input.command;
			if (typeof command === "string" && ROOT_FIND.test(command)) {
				return {
					block: true,
					reason:
						'Blocked: `find` starting at filesystem root "/" is disabled. Scope the search to a subdirectory instead.',
				};
			}
		}

		if (event.toolName === "find") {
			const path = event.input.path;
			if (path === "/" || path === "//") {
				return {
					block: true,
					reason:
						'Blocked: find tool with path "/" scans the whole filesystem. Scope the glob to a subdirectory instead.',
				};
			}
		}

		return undefined;
	});
}
