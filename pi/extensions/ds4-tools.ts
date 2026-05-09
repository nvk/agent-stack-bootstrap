import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createBashToolDefinition } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, statSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { dirname, resolve } from "path";

const DS4_PI_MAX_TOKENS = Number(process.env.DS4_PI_MAX_TOKENS || 4096);
const DS4_PI_REPLAY_WRITE_CONTENT_CHARS = Number(process.env.DS4_PI_REPLAY_WRITE_CONTENT_CHARS || 240);
const DS4_PI_REPLAY_COMMAND_CHARS = Number(process.env.DS4_PI_REPLAY_COMMAND_CHARS || 800);
let activeScaffoldPaths: string[] = [];
let activeScaffoldKey = "";
let activeScaffoldFollowUps = 0;
const writeFilesSchema = Type.Object({
	files: Type.Array(
		Type.Object({
			path: Type.String({ description: "File path, absolute or relative to the current working directory" }),
			content: Type.String({ description: "Complete file content to write" }),
		}),
		{ minItems: 1, description: "Files to create or overwrite" },
	),
});
const writeNextScaffoldFileSchema = Type.Object({
	content: Type.String({ description: "Complete content for the next empty scaffold file" }),
});

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
- For multi-step tasks, keep using tools until the user's requested outcome is complete. Do not stop after a setup command if more files, edits, tests, or verification are still required.
- If the user names specific files, the task is incomplete until every named file has been created or edited and verified.
- Empty placeholder files do not count as complete. If you create placeholders, continue immediately by writing useful content into each named file.
- For compact multi-file project scaffolds, use write_files for the initial files, then verify. Do not use a standalone mkdir as the first and only action.
- For comprehensive guides, long documents, or multi-file websites, avoid one giant tool call. Create the folder, then write files in smaller sequential calls so each tool-call argument stays bounded.
- When the user asks for a comprehensive website, deliver a complete but bounded first version: use clear sections, concise copy, and working CSS/JS instead of trying to exhaust the topic in one response.
- Never end with future intent such as "Let me", "I'll", "I will", "next", "should", or "ready to". If you identify a problem, fix it with tools before answering.
- Final answers must describe completed work only. Do not say you are about to fix, rewrite, verify, inspect, or continue; perform that action with a tool first.
- When building web files, verify cross-file references: linked CSS/JS files exist, inline event handlers have matching functions, and button IDs used by JavaScript exist in HTML.

Tool rules:
- Prefer read, grep, find, and ls for file inspection.
- Use run_bash for git, curl, rg, tests, or shell state.
- macOS grep does not support -P. Prefer rg, grep -E, sed, awk, or perl.
- Use bounded commands. For ping, use ping -c 1 or pass a timeout.
- Call tools as actual tool calls. Never print a JSON object or markdown representation of a tool call.
- Treat "(no output)" from a successful command as success, especially for mkdir, cp, mv, rm, touch, chmod, git add, and formatting commands. Continue with the next required step.
- For compact multi-file scaffolds, prefer write_files.
- For comprehensive multi-file guides/sites, do not put every file in one write_files call and do not use one huge heredoc command. Use separate write calls for HTML, CSS, and JS, then verify.
- Keep generated file writes bounded. As a rule of thumb, keep an initial HTML guide under 180 lines, CSS under 140 lines, and JS under 100 lines unless the user explicitly asks for more.
- JSON/session logs escape newlines and quotes. Do not conclude that a written file is malformed from escaped text shown in a transcript. Trust successful write results, then verify by reading the file, grepping it, or running a syntax check.
- Historical large write and heredoc command calls may be summarized in replay to keep the local model stable. If you need exact file contents, read the file.

If you must emit tool-call syntax directly, emit only this form with no surrounding text:
<tool_call>{"name":"run_bash","arguments":{"command":"pwd && rg -n \\"needle\\" .","timeout":10}}</tool_call>

After each tool result, decide whether the user's requested task is complete. If it is incomplete, call the next necessary tool. If it is complete, give a short final answer grounded in the tool results. Do not invent unrelated next tasks and do not add generic closing offers.`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseToolArguments(rawArguments: unknown): Record<string, unknown> | undefined {
	if (typeof rawArguments !== "string") {
		return undefined;
	}
	try {
		const args: unknown = JSON.parse(rawArguments);
		if (!isRecord(args)) {
			return undefined;
		}
		return args;
	} catch {
		return undefined;
	}
}

function compressibleToolCall(toolCall: unknown): { id: string; summary: string } | undefined {
	if (!isRecord(toolCall) || !isRecord(toolCall.function)) {
		return undefined;
	}
	const id = typeof toolCall.id === "string" ? toolCall.id : "";
	const name = typeof toolCall.function.name === "string" ? toolCall.function.name : "";
	const args = parseToolArguments(toolCall.function.arguments);
	if (!id || !args) {
		return undefined;
	}
	if (name === "write" && typeof args.path === "string" && typeof args.content === "string") {
		if (args.content.length > DS4_PI_REPLAY_WRITE_CONTENT_CHARS) {
			return {
				id,
				summary: `Completed write: ${args.path} (${args.content.length} chars; content omitted from replay).`,
			};
		}
	}
	if (name === "write_files" && Array.isArray(args.files)) {
		let totalChars = 0;
		const paths: string[] = [];
		for (const file of args.files) {
			if (isRecord(file)) {
				if (typeof file.content === "string") {
					totalChars += file.content.length;
				}
				if (typeof file.path === "string") {
					paths.push(file.path);
				}
			}
		}
		if (totalChars > DS4_PI_REPLAY_WRITE_CONTENT_CHARS) {
			return {
				id,
				summary: `Completed write_files: ${paths.join(", ")} (${totalChars} chars total; contents omitted from replay).`,
			};
		}
	}
	if (name === "run_bash" && typeof args.command === "string") {
		if (args.command.length > DS4_PI_REPLAY_COMMAND_CHARS) {
			return {
				id,
				summary: `Completed run_bash: command omitted from replay (${args.command.length} chars).`,
			};
		}
	}
	return undefined;
}

function compressLargeToolHistory(payload: Record<string, unknown>): Record<string, unknown> {
	const messages = payload.messages;
	if (!Array.isArray(messages)) {
		return payload;
	}
	let changed = false;
	const skipToolResultIds = new Set<string>();
	const compressedMessages: unknown[] = [];
	for (const message of messages) {
		if (isRecord(message) && message.role === "tool" && typeof message.tool_call_id === "string" && skipToolResultIds.has(message.tool_call_id)) {
			changed = true;
			continue;
		}
		if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.tool_calls)) {
			compressedMessages.push(message);
			continue;
		}
		const summaries: string[] = [];
		const keptToolCalls: unknown[] = [];
		for (const toolCall of message.tool_calls) {
			const compressed = compressibleToolCall(toolCall);
			if (compressed) {
				summaries.push(compressed.summary);
				skipToolResultIds.add(compressed.id);
			} else {
				keptToolCalls.push(toolCall);
			}
		}
		if (summaries.length === 0) {
			compressedMessages.push(message);
			continue;
		}
		changed = true;
		if (keptToolCalls.length > 0) {
			compressedMessages.push({ ...message, tool_calls: keptToolCalls });
		}
		compressedMessages.push({ role: "assistant", content: summaries.join("\n") });
	}
	return changed ? { ...payload, messages: compressedMessages } : payload;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const item of content) {
		if (isRecord(item) && typeof item.text === "string") {
			parts.push(item.text);
		}
	}
	return parts.join("\n");
}

function latestUserMessage(messages: unknown[]): { index: number; text: string } | undefined {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (isRecord(message) && message.role === "user") {
			return { index, text: contentToText(message.content) };
		}
	}
	return undefined;
}

function looksLikeNewMultiFileProject(text: string): boolean {
	const normalized = text.toLowerCase();
	if (!/\b(create|build|make|generate|scaffold)\b/.test(normalized)) {
		return false;
	}
	const fileMatches = normalized.match(/\b[\w.-]+\.(html|css|js|ts|tsx|jsx|md|json)\b/g) ?? [];
	const mentionsWebsite = /\b(website|site|app|project|folder|directory|guide)\b/.test(normalized);
	return fileMatches.length >= 2 && mentionsWebsite;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function extractNamedFiles(text: string): string[] {
	return Array.from(new Set(text.match(/\b[\w.-]+\.(?:html|css|js|ts|tsx|jsx|md|json)\b/gi) ?? []));
}

function extractTargetDir(text: string): string | undefined {
	const match =
		text.match(/\bin\s+([^\s`'"]+?)\/?\s+(?:new\s+)?(?:folder|directory)\b/i) ??
		text.match(/\b(?:folder|directory)\s+([^\s`'"]+)\b/i);
	if (!match) {
		return undefined;
	}
	return match[1].replace(/[.,;:]+$/, "").replace(/\/+$/, "");
}

function scaffoldPathsFromText(text: string): string[] {
	const files = extractNamedFiles(text);
	if (files.length < 2) {
		return [];
	}
	const targetDir = extractTargetDir(text);
	return files.map((file) => (file.includes("/") || !targetDir ? file : `${targetDir}/${file}`));
}

function fileState(cwd: string, filePath: string): "missing" | "empty" | "nonempty" {
	const absolutePath = resolve(cwd, filePath);
	if (!existsSync(absolutePath)) {
		return "missing";
	}
	try {
		return statSync(absolutePath).size > 0 ? "nonempty" : "empty";
	} catch {
		return "missing";
	}
}

function lineBudgetFor(filePath: string): string {
	if (filePath.endsWith(".html")) {
		return "Write a complete HTML guide page in about 90-140 lines. Link the requested CSS and JS basenames.";
	}
	if (filePath.endsWith(".css")) {
		return "Write complete CSS in about 60-100 lines.";
	}
	if (filePath.endsWith(".js")) {
		return "Write complete JavaScript in about 20-60 lines.";
	}
	return "Write complete useful content, but keep this single file bounded.";
}

type ScaffoldAction =
	| { type: "touch"; paths: string[]; command: string }
	| { type: "write"; path: string };

function nextScaffoldAction(cwd: string, paths: string[]): ScaffoldAction | undefined {
	if (paths.length < 2) {
		return undefined;
	}
	const states = paths.map((path) => ({ path, state: fileState(cwd, path) }));
	const missing = states.filter((entry) => entry.state === "missing");
	if (missing.length > 0) {
		const dirs = Array.from(new Set(paths.map((path) => dirname(path)).filter((dir) => dir !== ".")));
		const mkdirPart = dirs.length > 0 ? `mkdir -p ${dirs.map(shellQuote).join(" ")} && ` : "";
		const command = `${mkdirPart}touch ${paths.map(shellQuote).join(" ")} && ls -l ${dirs.length === 1 ? shellQuote(dirs[0]) : "."}`;
		return { type: "touch", paths, command };
	}
	const empty = states.filter((entry) => entry.state === "empty");
	if (empty.length > 0) {
		return { type: "write", path: empty[0].path };
	}
	return undefined;
}

function contentMaxLengthFor(filePath: string): number {
	if (filePath.endsWith(".html")) {
		return 12000;
	}
	if (filePath.endsWith(".css")) {
		return 6500;
	}
	if (filePath.endsWith(".js")) {
		return 3500;
	}
	return 8000;
}

function constrainToolsForAction(tools: unknown, action: ScaffoldAction | undefined): unknown {
	if (!Array.isArray(tools) || !action || action.type !== "write") {
		return tools;
	}
	return tools.map((tool) => {
		if (!isRecord(tool) || !isRecord(tool.function)) {
			return tool;
		}
		if (tool.function.name === "write_next_scaffold_file") {
			const parameters = isRecord(tool.function.parameters) ? tool.function.parameters : { type: "object" };
			const properties = isRecord(parameters.properties) ? parameters.properties : {};
			const content = isRecord(properties.content) ? properties.content : { type: "string" };
			return {
				...tool,
				function: {
					...tool.function,
					description: `Write the next empty scaffold file. For this turn it will write ${action.path}.`,
					parameters: {
						...parameters,
						required: ["content"],
						properties: {
							...properties,
							content: {
								...content,
								type: "string",
								maxLength: contentMaxLengthFor(action.path),
								description: `${lineBudgetFor(action.path)} Provide only the complete file content.`,
							},
						},
					},
				},
			};
		}
		if (tool.function.name !== "write") {
			return tool;
		}
		const parameters = isRecord(tool.function.parameters) ? tool.function.parameters : { type: "object" };
		const properties = isRecord(parameters.properties) ? parameters.properties : {};
		const content = isRecord(properties.content) ? properties.content : { type: "string" };
		const required = Array.isArray(parameters.required)
			? Array.from(new Set([...parameters.required.filter((item): item is string => typeof item === "string"), "path", "content"]))
			: ["path", "content"];
		return {
			...tool,
			function: {
				...tool.function,
				description: `${typeof tool.function.description === "string" ? tool.function.description : "Write a file."} For this turn, path must be exactly ${action.path}.`,
				parameters: {
					...parameters,
					required,
					properties: {
						...properties,
						path: {
							type: "string",
							enum: [action.path],
							description: `Must be exactly ${action.path}`,
						},
						content: {
							...content,
							type: "string",
							maxLength: contentMaxLengthFor(action.path),
							description: `${typeof content.description === "string" ? content.description : "File content."} Keep content bounded for this ds4 turn.`,
						},
					},
				},
			},
		};
	});
}

function scaffoldGuardInstruction(cwd: string, text: string): string | undefined {
	if (!looksLikeNewMultiFileProject(text)) {
		return undefined;
	}
	const paths = scaffoldPathsFromText(text);
	if (paths.length < 2) {
		return undefined;
	}
	const scaffoldKey = paths.join("\n");
	if (scaffoldKey !== activeScaffoldKey) {
		activeScaffoldKey = scaffoldKey;
		activeScaffoldFollowUps = 0;
	}
	activeScaffoldPaths = paths;
	const action = nextScaffoldAction(cwd, paths);
	if (!action) {
		return undefined;
	}
	if (action.type === "touch") {
		return `# Current Multi-File Creation Guard

The current user request asks you to create a new multi-file project.

Your next assistant message must be exactly one small run_bash tool call with this command:
${action.command}

Do not write file contents yet. Do not answer after this result; empty placeholders are not completion.`;
	}
	return `# Current Multi-File Creation Guard

The current user request asks you to create a new multi-file project, and ${action.path} is still empty.

Your next assistant message must be exactly one write_next_scaffold_file tool call. It will write this path:
${action.path}

${lineBudgetFor(action.path)}
Do not write any other file in the same assistant message. Do not answer until every requested file is non-empty and verified.`;
}

function addScaffoldGuard(cwd: string, payload: Record<string, unknown>): Record<string, unknown> {
	const messages = payload.messages;
	if (!Array.isArray(messages)) {
		return payload;
	}
	const latestUser = latestUserMessage(messages);
	if (!latestUser) {
		return payload;
	}
	const instruction = scaffoldGuardInstruction(cwd, latestUser.text);
	if (!instruction) {
		return payload;
	}
	const action = nextScaffoldAction(cwd, activeScaffoldPaths);
	const maxTokens =
		action?.type === "touch"
			? 1024
			: action?.type === "write" && !action.path.endsWith(".html")
				? 2048
				: undefined;
	return {
		...payload,
		...(maxTokens && typeof payload.max_tokens === "number" ? { max_tokens: Math.min(payload.max_tokens, maxTokens) } : {}),
		tools: constrainToolsForAction(payload.tools, action),
		...(action?.type === "write" ? { tool_choice: { type: "function", function: { name: "write_next_scaffold_file" } } } : {}),
		messages: [...messages, { role: "system", content: instruction }],
	};
}

function adjustPayload(cwd: string, payload: Record<string, unknown>): Record<string, unknown> {
	return addScaffoldGuard(cwd, compressLargeToolHistory(payload));
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
		if (!Array.isArray(tools) || tools.length === 0) {
			return;
		}
		return adjustPayload(cwd, {
			...payload,
			temperature: 0,
			top_p: 0.8,
			seed: 1,
			think: false,
			max_tokens:
				typeof payload.max_tokens === "number"
					? Math.min(payload.max_tokens, DS4_PI_MAX_TOKENS)
					: DS4_PI_MAX_TOKENS,
			tool_choice: payload.tool_choice ?? "auto",
		});
	});

	pi.on("tool_call", (event) => {
		const action = nextScaffoldAction(cwd, activeScaffoldPaths);
		if (!action) {
			return;
		}
		if (action.type === "touch") {
			if ((event.toolName === "run_bash" || event.toolName === "bash") && isRecord(event.input) && typeof event.input.command === "string") {
				const command = event.input.command;
				if (command.includes("touch") && action.paths.every((path) => command.includes(path))) {
					return;
				}
			}
			return {
				block: true,
				reason: `For this multi-file scaffold, first create placeholders with exactly this run_bash command: ${action.command}`,
			};
		}
		if (event.toolName === "write" && isRecord(event.input) && typeof event.input.path === "string") {
			if (resolve(cwd, event.input.path) === resolve(cwd, action.path)) {
				return;
			}
		}
		if (event.toolName === "write_next_scaffold_file") {
			return;
		}
		return {
			block: true,
			reason: `For this multi-file scaffold, use write_next_scaffold_file next. It will write ${action.path}. ${lineBudgetFor(action.path)}`,
		};
	});

	pi.on("agent_end", () => {
		const action = nextScaffoldAction(cwd, activeScaffoldPaths);
		if (!action || activeScaffoldFollowUps >= 8) {
			return;
		}
		activeScaffoldFollowUps += 1;
		if (action.type === "touch") {
			pi.sendUserMessage(`Continue the scaffold. Run exactly this command as one run_bash tool call, then keep going: ${action.command}`, {
				deliverAs: "followUp",
			});
			return;
		}
		pi.sendUserMessage(`Continue the scaffold. ${action.path} is still empty. Your next assistant message must be exactly one write_next_scaffold_file tool call. It will write ${action.path}. ${lineBudgetFor(action.path)}`, {
			deliverAs: "followUp",
		});
	});

	pi.registerTool({
		name: "write_next_scaffold_file",
		label: "write_next_scaffold_file",
		description:
			"Write the next empty file in a guarded multi-file scaffold. The extension chooses the path; provide only complete file content.",
		promptSnippet: "Write the next empty scaffold file",
		promptGuidelines: [
			"Use this only when instructed by the DS4 scaffold guard.",
			"Provide complete content for the next file only.",
			"Do not include markdown fences or commentary in content unless the target file format requires it.",
		],
		parameters: writeNextScaffoldFileSchema,
		async execute(_toolCallId, { content }, signal) {
			if (signal?.aborted) {
				throw new Error("Operation aborted");
			}
			const action = nextScaffoldAction(cwd, activeScaffoldPaths);
			if (!action || action.type !== "write") {
				throw new Error("No empty scaffold file is currently waiting to be written.");
			}
			const absolutePath = resolve(cwd, action.path);
			await mkdir(dirname(absolutePath), { recursive: true });
			await writeFile(absolutePath, content, "utf-8");
			return {
				content: [{ type: "text", text: `Wrote next scaffold file: ${action.path} (${content.length} bytes)` }],
				details: undefined,
			};
		},
	});

	pi.registerTool({
		name: "write_files",
		label: "write_files",
		description:
			"Create or overwrite multiple files in one call. Creates parent directories automatically. Use this for compact multi-file projects such as small websites, docs, examples, and scaffolds.",
		promptSnippet: "Write compact multi-file scaffolds in one tool call",
		promptGuidelines: [
			"Use write_files for compact new multi-file scaffolds instead of several separate write calls.",
			"For comprehensive guides, long documents, or larger multi-file websites, use separate write calls so each tool-call argument stays bounded.",
			"When the user names exact files for a compact new project, write those files in one write_files call, then verify with ls/grep/read/run_bash as needed.",
			"Do not pass empty content for a named file unless the user explicitly asks for an empty file.",
		],
		parameters: writeFilesSchema,
		async execute(_toolCallId, { files }, signal) {
			const written: string[] = [];
			for (const file of files) {
				if (signal?.aborted) {
					throw new Error("Operation aborted");
				}
				const absolutePath = resolve(cwd, file.path);
				await mkdir(dirname(absolutePath), { recursive: true });
				await writeFile(absolutePath, file.content, "utf-8");
				written.push(`${file.path} (${file.content.length} bytes)`);
			}
			return {
				content: [{ type: "text", text: `Wrote ${written.length} file(s):\n${written.join("\n")}` }],
				details: undefined,
			};
		},
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
			"For PR review, use run_bash to inspect git status, remotes, diffs, and GitHub CLI output before responding.",
			"When using run_bash, emit the tool call by itself; do not add explanatory prose in the same assistant message.",
			"Never print a JSON or markdown representation of a run_bash call; execute the actual tool call.",
			"For commands that can run forever, such as ping, tail, servers, or watch, use a bounded command or set the timeout argument.",
			"Treat run_bash tool results as actual command output from this machine; never describe them as simulated, hypothetical, or unavailable.",
			"If run_bash returns '(no output)' for a successful command, treat it as success and continue with the next required step.",
			"After a run_bash result, continue with more tools when the user's task is incomplete. Only stop when the requested outcome is complete.",
			"Do not add generic closing offers.",
			"If more evidence is required to answer the current user request, continue with more run_bash/read calls instead of asking the user to provide local file contents.",
		],
	});
}
