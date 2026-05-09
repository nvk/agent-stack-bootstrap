import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";

const DS4_PI_MAX_TOKENS = Number(process.env.DS4_PI_MAX_TOKENS || 2048);

const DS4_TOOL_PROTOCOL = `# DS4 Tool Protocol

You are running on a local ds4 model. Be terse, literal, and tool-first.

Hard rules:
- Do not narrate hidden reasoning. Do not write "The user wants", "Let me", "I need to", or long self-analysis.
- Do not claim you lack filesystem access. If the user names a path, inspect it with read/find/grep/ls or run_bash.
- Do not ask the user to paste file contents when tools can inspect the file.
- Do not switch languages unless the user asks.
- Do not invent prior file contents. If asked to reverse a change, inspect the current file and restore only the specific change the user named. Prefer a targeted edit over rewriting the file.
- Do not rewrite an entire file unless the user explicitly asks for a rewrite.
- For a one-line replacement, first read the file, then call edit with the exact old and new strings. Do not answer until the edit tool succeeds.
- After completing a small edit, answer with only what changed and the file path.

Tool rules:
- Prefer read, grep, find, and ls for file inspection.
- Use run_bash for git, curl, rg, tests, or shell state.
- macOS grep does not support -P. Prefer rg, grep -E, sed, awk, or perl.
- Use bounded commands. For ping, use ping -c 1 or pass a timeout.
- Call tools as actual tool calls. Never print a JSON object or markdown representation of a tool call.

After a tool result, answer only the user's request from the result, then stop. Do not invent a next task and do not add generic closing offers.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeStopSequences(existing: unknown, additions: string[]): string[] {
	const values = new Set<string>();
	if (typeof existing === "string") {
		values.add(existing);
	} else if (Array.isArray(existing)) {
		for (const item of existing) {
			if (typeof item === "string") {
				values.add(item);
			}
		}
	}
	for (const item of additions) {
		values.add(item);
	}
	return Array.from(values);
}

export default function ds4Tools(pi: ExtensionAPI) {
	const cwd = process.cwd();
	const bash = createBashToolDefinition(cwd);

	pi.on("before_agent_start", (event) => {
		if (event.systemPrompt.includes("# DS4 Tool Protocol")) {
			return;
		}
		return {
			systemPrompt: `${event.systemPrompt}\n\n${DS4_TOOL_PROTOCOL}`,
		};
	});

	pi.on("before_provider_request", (event) => {
		const payload = event.payload;
		if (!isRecord(payload)) {
			return;
		}
		const tools = payload.tools;
		if (!Array.isArray(tools) || tools.length === 0 || payload.tool_choice !== undefined) {
			return;
		}
		return {
			...payload,
			temperature: 0,
			top_p: 0.8,
			seed: 1,
			think: false,
			max_tokens:
				typeof payload.max_tokens === "number"
					? Math.min(payload.max_tokens, DS4_PI_MAX_TOKENS)
					: DS4_PI_MAX_TOKENS,
			tool_choice: "auto",
			stop: mergeStopSequences(payload.stop, [
				"\n\nWould you like",
				"\nWould you like",
				"\n\nIf you have",
				"\nIf you have",
				"\n\nIf you need",
				"\nIf you need",
			]),
		};
	});

	pi.registerTool({
		...bash,
		name: "run_bash",
		label: "run_bash",
		description:
			"Execute a shell command in the current working directory. Returns stdout and stderr. Use this for git, gh, rg, find, ls, tests, and other command-line inspection.",
		promptSnippet: "Execute shell commands (git, gh, rg, find, ls, tests, etc.)",
		promptGuidelines: [
			"Use run_bash instead of claiming you cannot inspect local files, repositories, GitHub PRs, or command output.",
			"When using run_bash, emit the tool call by itself; do not add explanatory prose in the same assistant message.",
			"Never print a JSON or markdown representation of a run_bash call; execute the actual tool call.",
			"For commands that can run forever, such as ping, tail, servers, or watch, use a bounded command or set the timeout argument.",
			"Treat run_bash tool results as actual command output from this machine; never describe them as simulated, hypothetical, or unavailable.",
			"After a run_bash result, answer the user's request from that output and stop; do not invent unrelated next tasks or ask the user to show files.",
			"Do not add generic closing offers.",
			"If more evidence is required to answer the current user request, continue with more run_bash/read calls instead of asking the user to provide local file contents.",
		],
	});
}
