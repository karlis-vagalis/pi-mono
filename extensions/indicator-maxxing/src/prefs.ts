import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { SpinnerType } from "./indicators.ts";

interface SpinnerPrefs {
	spinner: string;
}

const PREFS_FILE = join(getAgentDir(), "claudify.json");

function readPrefs(): SpinnerPrefs {
	if (!existsSync(PREFS_FILE)) return { spinner: SpinnerType.Sparkle };
	try {
		return JSON.parse(readFileSync(PREFS_FILE, "utf-8")) as SpinnerPrefs;
	} catch {
		return { spinner: SpinnerType.Sparkle };
	}
}

function writePrefs(prefs: Partial<SpinnerPrefs>): void {
	const current = readPrefs();
	const merged = { ...current, ...prefs };
	writeFileSync(PREFS_FILE, JSON.stringify(merged, null, 2));
}

/** Load the persisted spinner type, falling back to Sparkle. */
export function loadSpinnerPref(): SpinnerType {
	const prefs = readPrefs();
	const type = Object.values(SpinnerType).find((t) => t === prefs.spinner);
	return type ?? SpinnerType.Sparkle;
}

/** Persist a spinner type choice. */
export function saveSpinnerPref(type: SpinnerType): void {
	writePrefs({ spinner: type });
}
