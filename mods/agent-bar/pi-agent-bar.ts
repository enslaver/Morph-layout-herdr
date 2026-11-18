/**
 * agent-bar - pi extension: tells Herdr's agent-bar mod what this pi session is using.
 *
 * Writes ~/.cache/herdr-agent-bar/<HC_TERMINAL_ID>.json (the same place Claude Code's status
 * line wrapper writes) on start, model / thinking changes and after each turn:
 *   { agent: "pi", cwd, session_name, model: {id, display_name, provider}, effort: {level},
 *     context_window: {used_percentage, total_input_tokens, context_window_size},
 *     models: [{label, value}], levels: [...] }
 * And adds two commands the bar types when you pick something:
 *   /herdr-model <provider>/<id>     /herdr-thinking <level>
 *
 * Install: copy (or link) into ~/.pi/agent/extensions/. Outside Herdr (no HC_TERMINAL_ID) it
 * writes nothing.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TERM = process.env.HC_TERMINAL_ID;
const DIR = `${process.env.HOME}/.cache/herdr-agent-bar`;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

export default function (pi: ExtensionAPI) {
	const save = (ctx: any) => {
		if (!TERM) return;
		try {
			const m = ctx.model;
			const usage = ctx.getContextUsage?.();
			// The models you cycle through (settings.json enabledModels), else the first 40 available.
			let enabled: string[] = [];
			try { enabled = JSON.parse(readFileSync(`${process.env.HOME}/.pi/agent/settings.json`, "utf8")).enabledModels ?? []; } catch {}
			const all = (ctx.modelRegistry?.getAvailable?.() ?? []).map((x: any) => ({ label: x.name ?? x.id, value: `${x.provider}/${x.id}` }));
			const picked = enabled.length ? all.filter((x: any) => enabled.includes(x.value)) : [];
			const models = (picked.length ? picked : all).slice(0, 40);
			const data = {
				agent: "pi",
				cwd: ctx.cwd,
				session_name: ctx.sessionManager?.getSessionName?.(),
				model: m ? { id: `${m.provider}/${m.id}`, display_name: m.name ?? m.id, provider: m.provider } : null,
				effort: { level: pi.getThinkingLevel() },
				context_window: usage
					? { used_percentage: usage.percent == null ? null : Math.round(usage.percent), total_input_tokens: usage.tokens, context_window_size: usage.contextWindow }
					: null,
				models,
				levels: LEVELS,
				saved_at: Date.now(),
			};
			mkdirSync(DIR, { recursive: true });
			const tmp = `${DIR}/.${TERM}.${process.pid}.tmp`;
			writeFileSync(tmp, JSON.stringify(data));
			renameSync(tmp, `${DIR}/${TERM}.json`);
		} catch {
			// The bar is a nicety; never break a pi session over it.
		}
	};

	for (const ev of ["session_start", "model_select", "thinking_level_select", "turn_end", "agent_end", "session_compact"] as const) {
		pi.on(ev as any, async (_e: any, ctx: any) => save(ctx));
	}

	pi.registerCommand("herdr-model", {
		description: "Switch model (used by Herdr's agent bar): provider/id",
		handler: async (args, ctx: any) => {
			const v = args.trim(), i = v.indexOf("/");
			const model = i > 0 ? ctx.modelRegistry.find(v.slice(0, i), v.slice(i + 1)) : undefined;
			if (!model) return ctx.ui.notify(`No model ${v}`, "error");
			if (!(await pi.setModel(model))) ctx.ui.notify(`Couldn't switch to ${v} (no API key?)`, "error");
			save(ctx);
		},
	});

	pi.registerCommand("herdr-thinking", {
		description: "Set the thinking level (used by Herdr's agent bar)",
		getArgumentCompletions: (p) => LEVELS.filter((l) => l.startsWith(p)).map((l) => ({ value: l, label: l })),
		handler: async (args, ctx: any) => {
			const level = args.trim();
			if (!LEVELS.includes(level)) return ctx.ui.notify(`Unknown thinking level ${level}`, "error");
			pi.setThinkingLevel(level as any);
			save(ctx);
		},
	});
}
