import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";

export enum SpinnerType {
	Classic = "classic",
	DotsArc = "dots-arc",
	BrailleWave = "braille-wave",
	QuadrantSpin = "quadrant-spin",
	CornerBlocks = "corner-blocks",
	FullToEmpty = "full-to-empty",
	ClockwiseCircles = "clockwise-circles",
	HalfCircles = "half-circles",
	CircleQuarters = "circle-quarters",
	RotatingPipe = "rotating-pipe",
	LineBounce = "line-bounce",
	VerticalEqualizer = "vertical-equalizer",
	HorizontalFill = "horizontal-fill",
	GrowingDots = "growing-dots",
	MoonPhases = "moon-phases",
	ClockFaces = "clock-faces",
	TrigramRadar = "trigram-radar",
	Arrows = "arrows",

	// Famous CLI favorites
	BouncingBall = "bouncing-ball",

	// Exotic geometric & math operators
	GeometricMorph = "geometric-morph",
	SquarePulse = "square-pulse",
	GeometricDiamond = "geometric-diamond",
	StarBurst = "star-burst",
	TrianglesSpin = "triangles-spin",
	BoxLineSlide = "box-line-slide",

	// Weather & nature metaphors
	EarthRotating = "earth-rotating",
	HourglassFlip = "hourglass-flip",

	// Subtle & minimalist
	MinimalLinePulse = "minimal-line-pulse",
	BinaryFlicker = "binary-flicker",

	// Default spinner
	Sparkle = "sparkle",
}

export interface SpinnerPreset {
	frames: readonly string[];
	intervalMs: number;
}

export const SPINNER_PRESETS: Record<SpinnerType, SpinnerPreset> = {
	// Braille patterns
	[SpinnerType.Classic]: {
		frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		intervalMs: 100,
	},
	[SpinnerType.DotsArc]: {
		frames: ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"],
		intervalMs: 100,
	},
	[SpinnerType.BrailleWave]: {
		frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"],
		intervalMs: 120,
	},

	// Block & grid shapes
	[SpinnerType.QuadrantSpin]: {
		frames: ["▖", "▘", "▝", "▗"],
		intervalMs: 150,
	},
	[SpinnerType.CornerBlocks]: {
		frames: ["▛", "▜", "▟", "▙"],
		intervalMs: 150,
	},
	[SpinnerType.FullToEmpty]: {
		frames: ["█", "▓", "▒", "░"],
		intervalMs: 200,
	},

	// Geometric circles & lines
	[SpinnerType.ClockwiseCircles]: {
		frames: ["◴", "◷", "◶", "◵"],
		intervalMs: 150,
	},
	[SpinnerType.HalfCircles]: {
		frames: ["◐", "◓", "◑", "◒"],
		intervalMs: 150,
	},
	[SpinnerType.CircleQuarters]: {
		frames: ["◜", "◝", "◞", "◟"],
		intervalMs: 150,
	},
	[SpinnerType.RotatingPipe]: {
		frames: ["|", "/", "-", "\\"],
		intervalMs: 120,
	},
	[SpinnerType.LineBounce]: {
		frames: ["─", "╲", "│", "╱"],
		intervalMs: 120,
	},

	// Progress bars & waves
	[SpinnerType.VerticalEqualizer]: {
		frames: [
			" ",
			"▁",
			"▂",
			"▃",
			"▄",
			"▅",
			"▆",
			"▇",
			"█",
			"▇",
			"▆",
			"▅",
			"▄",
			"▃",
			"▂",
			"▁",
		],
		intervalMs: 100,
	},
	[SpinnerType.HorizontalFill]: {
		frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█"],
		intervalMs: 120,
	},
	[SpinnerType.GrowingDots]: {
		frames: [".", "..", "...", "...."],
		intervalMs: 200,
	},

	// Clocks & moons
	[SpinnerType.MoonPhases]: {
		frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"],
		intervalMs: 150,
	},
	[SpinnerType.ClockFaces]: {
		frames: [
			"🕐",
			"🕑",
			"🕒",
			"🕓",
			"🕔",
			"🕕",
			"🕖",
			"🕗",
			"🕘",
			"🕙",
			"🕚",
			"🕛",
		],
		intervalMs: 150,
	},

	// Trigrams & symbols
	[SpinnerType.TrigramRadar]: {
		frames: ["☰", "☱", "☳", "☷", "☶", "☴"],
		intervalMs: 150,
	},
	[SpinnerType.Arrows]: {
		frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"],
		intervalMs: 120,
	},

	// Famous CLI favorites
	[SpinnerType.BouncingBall]: {
		frames: [
			"(\u25cf     )",
			"( \u25cf    )",
			"(  \u25cf   )",
			"(   \u25cf  )",
			"(    \u25cf )",
			"(     \u25cf)",
			"(    \u25cf )",
			"(   \u25cf  )",
			"(  \u25cf   )",
			"( \u25cf    )",
		],
		intervalMs: 120,
	},
	// Exotic geometric & math operators
	[SpinnerType.GeometricMorph]: {
		frames: ["⬖", "⬘", "⬗", "⬙"],
		intervalMs: 150,
	},
	[SpinnerType.SquarePulse]: {
		frames: ["◰", "◳", "◲", "◱"],
		intervalMs: 150,
	},
	[SpinnerType.GeometricDiamond]: {
		frames: ["◇", "◈", "◆", "◈"],
		intervalMs: 150,
	},
	[SpinnerType.StarBurst]: {
		frames: ["✶", "✸", "✹", "✺", "✹", "✸"],
		intervalMs: 120,
	},
	[SpinnerType.TrianglesSpin]: {
		frames: ["▲", "►", "▼", "◄"],
		intervalMs: 150,
	},
	[SpinnerType.BoxLineSlide]: {
		frames: [
			"\u258c──────",
			"─\u258c─────",
			"──\u258c────",
			"───\u258c───",
			"────\u258c──",
			"─────\u258c─",
			"──────\u258c",
		],
		intervalMs: 120,
	},

	// Weather & nature metaphors
	[SpinnerType.EarthRotating]: {
		frames: ["🌍", "🌎", "🌏"],
		intervalMs: 300,
	},
	[SpinnerType.HourglassFlip]: {
		frames: ["⏳", "⌛"],
		intervalMs: 400,
	},

	// Subtle & minimalist
	[SpinnerType.MinimalLinePulse]: {
		frames: ["⎺", "⎻", "⎼", "⎽", "⎼", "⎻"],
		intervalMs: 120,
	},
	[SpinnerType.BinaryFlicker]: {
		frames: ["00", "01", "11", "10"],
		intervalMs: 200,
	},

	[SpinnerType.Sparkle]: {
		frames: ["·", "✢", "✶", "✻", "✽", "✻", "✶", "✢"],
		intervalMs: 150,
	},
};

/**
 * Apply theme coloring to a spinner preset's frames.
 * Returns the frames array with each frame wrapped in `theme.fg(color, ...)`.
 */
export function themeSpinner(
	preset: SpinnerPreset,
	theme: Theme,
	color: ThemeColor = "accent",
): string[] {
	return preset.frames.map((f) => theme.fg(color, f));
}
