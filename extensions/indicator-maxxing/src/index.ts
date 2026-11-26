import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import gradient from "gradient-string";
import { SPINNER_PRESETS, SpinnerType, themeSpinner } from "./indicators.ts";
import { loadSpinnerPref, saveSpinnerPref } from "./prefs.ts";
import { messages as thinkingMessages } from "./thinking-messages.ts";

/**
 * Parse a 24-bit ANSI true-color foreground escape into R, G, B.
 * Returns null on failure.
 */
function parseAnsiRgb(
	ansi: string,
): { r: number; g: number; b: number } | null {
	const m = ansi.match(/\[38;2;(\d+);(\d+);(\d+)m/);
	if (!m) return null;
	return {
		r: Number(m[1] ?? "0"),
		g: Number(m[2] ?? "0"),
		b: Number(m[3] ?? "0"),
	};
}

const ANIMATION_INTERVAL_MS = 70;
const FRAME_STEP = 18;

function travelingGradient(
	text: string,
	accent: { r: number; g: number; b: number },
	phase: number,
): string {
	// ADJUST THIS: 0.1 is dark, 0.5 is medium, 0.8 is very bright
	const floorBrightness = 0.6;

	const dim = {
		r: Math.round(accent.r * floorBrightness),
		g: Math.round(accent.g * floorBrightness),
		b: Math.round(accent.b * floorBrightness),
	};

	const p = (((phase % 720) + 720) % 720) / 720;
	const numStops = 12;
	const colors: Array<{ r: number; g: number; b: number }> = [];
	const sigma = 0.2; // Width of the highlight

	for (let i = 0; i < numStops; i++) {
		const stopPos = i / (numStops - 1);
		let dist = Math.abs(stopPos - p);
		if (dist > 0.5) dist = 1 - dist;

		// Gaussian curve
		const intensity = Math.exp(-(dist * dist) / (2 * sigma * sigma));

		colors.push({
			r: Math.round(dim.r + (accent.r - dim.r) * intensity),
			g: Math.round(dim.g + (accent.g - dim.g) * intensity),
			b: Math.round(dim.b + (accent.b - dim.b) * intensity),
		});
	}

	return gradient(colors)(text);
}

function pickRandom<T>(arr: readonly T[]): T {
	return arr[Math.floor(Math.random() * arr.length)] as T;
}

export default function (pi: ExtensionAPI) {
	let interval: ReturnType<typeof setInterval> | null = null;
	let currentText = "";
	let frame = 0;

	// ── Spinner preset (persisted globally) ─────────────────────
	let currentSpinner = loadSpinnerPref();

	// ── Working-message animation ───────────────────────────────
	pi.on("turn_start", async (_event, ctx) => {
		if (interval !== null) {
			clearInterval(interval);
		}

		currentText = `${pickRandom(thinkingMessages)}...`;
		frame = 0;

		const accentRgb = parseAnsiRgb(ctx.ui.theme.getFgAnsi("accent")) ?? {
			r: 200,
			g: 100,
			b: 80,
		};

		// Set initial frame immediately
		ctx.ui.setWorkingMessage(travelingGradient(currentText, accentRgb, frame));

		const preset = SPINNER_PRESETS[currentSpinner];
		ctx.ui.setWorkingIndicator({
			frames: themeSpinner(preset, ctx.ui.theme),
			intervalMs: preset.intervalMs,
		});

		interval = setInterval(() => {
			frame += FRAME_STEP;
			ctx.ui.setWorkingMessage(
				travelingGradient(currentText, accentRgb, frame),
			);
		}, ANIMATION_INTERVAL_MS);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (interval !== null) {
			clearInterval(interval);
			interval = null;
		}
		currentText = "";
		frame = 0;
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	});

	// ── /spinner command ─────────────────────────────────────────
	pi.registerCommand("spinner", {
		description: "Select the working indicator animation style",
		handler: async (_args, ctx: ExtensionCommandContext) => {
			const types = Object.values(SpinnerType);
			const labels = types.map(
				(t) =>
					`${t === currentSpinner ? "▸ " : "  "}${SPINNER_PRESETS[t].frames[0] ?? "?"}  ${t}`,
			);

			const selected = await ctx.ui.select("Select spinner style:", labels);
			if (!selected) return;

			const idx = labels.indexOf(selected);
			if (idx === -1) return;
			const chosen = types[idx];
			if (!chosen) return;

			currentSpinner = chosen;
			saveSpinnerPref(chosen);
			ctx.ui.notify(`Spinner: ${chosen}`, "info");
		},
	});
}
