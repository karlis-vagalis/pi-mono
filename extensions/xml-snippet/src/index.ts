import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteProvider,
	AutocompleteSuggestions,
} from "@earendil-works/pi-tui";

/**
 * Optional curated overrides: tag name -> body inserted between <name> and </name>.
 * Anything not listed here still expands generically to:
 *
 *   <key>
 *
 *   </key>
 *
 * with the cursor landing on the blank middle line so you can paste.
 */
const CURATED: Record<string, string> = {
	// "issue": "Describe the problem:",
};

// Match a bare "<name>" token at the cursor, skipping "<" that closes a tag ("</").
// `(^|[^\w/])` prevents matching inside "</", "<", or mid-word comparisons.
const KEY_RE = /(^|[^\w/])<([A-Za-z0-9][A-Za-z0-9_.:-]*)$/;

function detectTag(
	textBeforeCursor: string,
): { name: string; prefix: string } | null {
	const m = textBeforeCursor.match(KEY_RE);
	if (!m) return null;
	// m[0] = boundary + "<name"; prefix is the "<name" token we replace.
	// (boundary is "" when matched at the start of the line, hence the fallback)
	const boundary = m[1] ?? "";
	return { name: m[2] ?? "", prefix: m[0].slice(boundary.length) };
}

function createSnippetProvider(
	current: AutocompleteProvider,
): AutocompleteProvider {
	return {
		// "<" naturally opens the completion; keep matching as you type the key name.
		triggerCharacters: ["<"],

		async getSuggestions(
			lines,
			cursorLine,
			cursorCol,
			options,
		): Promise<AutocompleteSuggestions | null> {
			const before = (lines[cursorLine] ?? "").slice(0, cursorCol);
			const tag = detectTag(before);
			if (!tag) {
				// Not a "<name" token -> fall through to pi's built-in provider.
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const hasBody = tag.name in CURATED;
			return {
				prefix: tag.prefix,
				items: [
					{
						value: tag.name,
						label: `<${tag.name}>…</${tag.name}>`,
						description: hasBody ? "Custom snippet" : "Generic tag",
					},
				],
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			// Only handle snippets we produced (prefix is a "<name" token). Anything else
			// (@ paths, slash commands, file paths) must go to the wrapped provider.
			if (!prefix.startsWith("<")) {
				return current.applyCompletion(
					lines,
					cursorLine,
					cursorCol,
					item,
					prefix,
				);
			}

			// Rebuild the tag from the typed prefix ("<name") so it's always a valid pair;
			// item.value is ignored. Generic vs curated handled here.
			const before = lines[cursorLine] ?? "";
			const start = cursorCol - prefix.length;
			const name = prefix.slice(1); // strip "<"
			const opening = `<${name}>`;
			const closing = `</${name}>`;
			const body = CURATED[name] ?? "";

			const expansion =
				body === ""
					? `${opening}\n\n${closing}`
					: `${opening}\n${body}\n${closing}`;

			const head = before.slice(0, start);
			const tail = before.slice(cursorCol);
			const pieces = expansion.split("\n");

			const newLines = [
				...lines.slice(0, cursorLine),
				head + pieces[0],
				...pieces.slice(1, -1),
				pieces[pieces.length - 1] + tail,
				...lines.slice(cursorLine + 1),
			];

			// Cursor lands on the first body line, column 0 — right where you paste.
			return {
				lines: newLines,
				cursorLine: cursorLine + 1,
				cursorCol: 0,
			};
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return (
				current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ??
				true
			);
		},
	};
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createSnippetProvider(current));
	});
}
