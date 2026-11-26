import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { STYLE_CATEGORIES, STYLE_DIMENSIONS } from "./styles.ts";

function choose<T>(items: readonly T[]): T {
	return items[Math.floor(Math.random() * items.length)] as T;
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "random_style",
		label: "Random Art Style",
		description:
			"Generate a fresh art-direction combination by randomly selecting style dimensions. Returns a compact prompt string.",
		parameters: Type.Object({}),
		async execute() {
			const dimensions = [...STYLE_CATEGORIES];
			const amount = Math.min(
				2 + Math.floor(Math.random() * 4),
				dimensions.length,
			);
			const selected: string[] = [];
			for (let i = 0; i < amount; i++) {
				const category = dimensions.splice(
					Math.floor(Math.random() * dimensions.length),
					1,
				)[0];
				if (!category) continue;
				selected.push(choose(STYLE_DIMENSIONS[category]));
			}
			const combination = selected.join(" x ");
			return {
				content: [{ type: "text", text: combination }],
				details: { combination, dimensions: selected },
			};
		},
	});
}
