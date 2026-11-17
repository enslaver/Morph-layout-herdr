// Agent bar: what the focused terminal is running, as clickable pills.
//   Claude Code  [✦ Opus 5.5] [◐ medium] [▤ 10%] [⎇ main] [+12 −3] [▸ …/x]   [¶ Concise] [$1.10] [◷ 17%]
//   pi           [π Sonnet 5] [◐ medium] [▤ 25%] [⎇ main] [+12 −3] [▸ …/x]
//   zsh/bash     [$ zsh] [⎇ main] [+12 −3] [▸ …/x]
// Anything else (nvim, codex, a mod pane's terminal-less focus keeps the last one) hides the
// block (layout.hide "agent-bar"; mod timers keep running while hidden, so it comes back).
//
// Data:
//   Claude Code  ./statusline.sh wraps the statusLine command and saves its JSON
//   pi           ./pi-agent-bar.ts (a pi extension) saves the same kind of JSON
//   both to ~/.cache/herdr-agent-bar/<terminal>.json; shells need nothing (panes() cwd + git).
// Clicks open agent-bar-pick: model / effort / style / context type a command into the agent
// (only when it's idle), the branch switches with git, changes and folder open the side panel.

import { View } from "gpui-kit";
import { h_flex } from "gpui-base";
import { theme, shared, exec, home, focused, panes, readTextFile, openOverlay, run, checking } from "herdr";

const glass = (c) => {
  const r = shared("rice") ?? {};
  const p = r["transparency.on"] === false ? 100 : (r["transparency.cards"] ?? 100);
  return p >= 100 || !/^#[0-9a-f]{6}$/i.test(c) ? c : c + Math.round((p / 100) * 255).toString(16).padStart(2, "0");
};
const MONO = "Geist Mono";
const BLOCK = "agent-bar";

const CLAUDE_MODELS = [
  { label: "Fable 5.2", value: "claude-fable-5-2" },
  { label: "Opus 5.5", value: "claude-opus-5-5" },
  { label: "Opus 5.5 · 1M", value: "claude-opus-5-5[1m]" },
  { label: "Sonnet 5.5", value: "claude-sonnet-5-5" },
  { label: "Haiku 5.5", value: "claude-haiku-5-5" },
];
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const STYLES = ["Default", "Explanatory", "Learning"];

const tilde = (p, h) => (h && p === h ? "~" : h && p?.startsWith(h + "/") ? "~" + p.slice(h.length) : p ?? "");
const short = (p) => { const s = p.split("/"); return s.length > 3 ? "…/" + s.slice(-2).join("/") : p; };

// What a pane runs, as far as the bar cares: "claude" | "pi" | "shell" | null (unsupported).
function kindOf(p) {
  // The running program wins: `app` is what last reported agent status and stays set after the
  // agent exits back to the shell.
  const key = p.program?.key, app = p.app;
  if (key === "claude") return "claude";
  if (key === "pi") return "pi";
  if (p.program?.shell || key === "shell") return "shell";
  if (key && key !== "program" && key !== "agent") return null;
  if (app === "claude-code") return "claude";
  if (app === "pi") return "pi";
  return null;
}

export default class AgentBar extends View {
  init(_props, cx) {
    this.target = null;   // {terminal, kind, machine, local, shell, cwd, branch}
    this.data = null;     // saved status JSON (claude / pi)
    this.git = null;      // {branch, add, del}
    this.shown = null;    // what we last told the layout
    this.home = home();
    this.styles = STYLES;
    cx.spawn(async (cx) => {
      const r = await exec("ls", [this.home + "/.claude/output-styles"]);
      if (r.code === 0) {
        const extra = r.stdout.split("\n").filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3));
        this.styles = [...STYLES, ...extra.filter((s) => !STYLES.includes(s))];
      }
    });
    this.refresh(cx);
    cx.timer.every(1500, (cx) => this.refresh(cx));
  }

  show(on) {
    if (on === this.shown || checking()) return;
    this.shown = on;
    run(on ? "layout.show" : "layout.hide", { id: BLOCK });
  }

  refresh(cx) {
    const f = focused();
    // Focus on something that isn't a terminal (a mod pane, an overlay): keep what we had.
    if (!f?.terminal) return;
    const p = (panes() ?? []).find((x) => x.terminal === f.terminal);
    const kind = p ? kindOf(p) : null;
    if (!kind) { this.show(false); return; }
    const machine = f.terminal.includes("/") ? f.terminal.split("/")[0] : null;
    const local = machine ? f.terminal.split("/").pop() : f.terminal;
    const target = { terminal: f.terminal, kind, machine, local, shell: p.program?.name ?? "shell", cwd: p.cwd ?? f.cwd, branch: p.branch };
    const moved = JSON.stringify(this.target) !== JSON.stringify(target);
    if (this.target?.terminal !== target.terminal || this.target?.kind !== kind) { this.data = null; this.git = null; this.cwd = null; }
    this.target = target;
    this.show(true);
    if (moved) cx.notify();
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const on = target.machine;
        let data = null;
        if (kind !== "shell") {
          try {
            const text = on
              ? (await exec("sh", ["-c", `cat "$HOME/.cache/herdr-agent-bar/${target.local}.json"`], { on, timeout: 3000 })).stdout
              : await readTextFile(`${this.home}/.cache/herdr-agent-bar/${target.local}.json`);
            data = JSON.parse(text || "null");
          } catch {}
          // A file another kind of program left behind isn't ours.
          if (data && (data.agent === "pi") !== (kind === "pi")) data = null;
        }
        const cwd = data?.workspace?.current_dir ?? data?.cwd ?? target.cwd;
        // git walks the tree: again only for a new folder or terminal, or every 6 s.
        let git = this.git;
        if (cwd && (!git || cwd !== this.gitCwd || Date.now() - (this.gitAt ?? 0) > 6000)) {
          git = null;
          this.gitCwd = cwd; this.gitAt = Date.now();
          const s = await exec("git", ["status", "--porcelain=2", "--branch"], { cwd, on, timeout: 2500 });
          if (s.code === 0) {
            const head = s.stdout.match(/^# branch\.head (.+)$/m)?.[1];
            const d = await exec("git", ["diff", "HEAD", "--shortstat"], { cwd, on, timeout: 2500 });
            git = {
              branch: head === "(detached)" ? "detached" : head ?? target.branch ?? "?",
              add: +(d.stdout.match(/(\d+) insertion/)?.[1] ?? 0),
              del: +(d.stdout.match(/(\d+) deletion/)?.[1] ?? 0),
            };
          }
        }
        if (this.target?.terminal === target.terminal) {
          const before = JSON.stringify([this.data, this.git]);
          this.data = data; this.git = git; this.cwd = cwd;
          if (JSON.stringify([data, git]) !== before) cx.notify();
        }
      } finally { this.busy = false; }
    });
  }

  pick(title, items, action) {
    openOverlay({
      mod: "agent-bar-pick", kind: "popup", frame: "none", width: 260,
      height: Math.min(420, 44 + items.length * 30),
      props: { title, items, action: { terminal: this.target.terminal, ...action } },
    });
  }

  panel(child) {
    run("layout.select", { stack: "panel-body", child });
    run("layout.show", { id: "panel" });
  }

  render(cx) {
    const t = theme();
    const tg = this.target, d = this.data, g = this.git;
    const root = h_flex().size_full().px(8).gap(6).items_center().font_family(MONO).text_size(11.5).text_color(t.muted);
    if (!tg) return root;
    const pill = (id, icon, text, color, tip, onClick) =>
      h_flex().id("ab-" + id).flex_none().h(24).px(10).gap(6).items_center().rounded(8)
        .bg(glass(t.background)).tooltip(tip)
        .child(h_flex().text_color(color ?? t.accent).child(icon))
        .child(h_flex().text_color(t.foreground).max_w(220).truncate().child(text))
        .when(!!onClick, (el) => el.cursor_pointer().hover((h) => h.bg(t.hover)).on_click((_e, cx) => onClick(cx)));
    const hot = (p) => (p >= 80 ? t.blocked : p >= 50 ? t.working : t.done);
    const cwd = this.cwd ?? tg.cwd;

    const left = h_flex().flex_1().min_w(0).gap(6).items_center().overflow_hidden();
    const right = h_flex().flex_none().gap(6).items_center();

    // The program: model for agents, the shell's name for shells.
    if (tg.kind === "claude") {
      const effort = d?.effort?.level;
      left.child(pill("model", "✦", d?.model?.display_name ?? "Claude Code", t.accent, "Model: choose another", () =>
        this.pick("Model", CLAUDE_MODELS.map((m) => ({ ...m, current: m.value === d?.model?.id })), { kind: "send", template: "/model {}" })));
      if (effort) left.child(pill("effort", "◐", effort, t.ansi13, "Effort: choose a level", () =>
        this.pick("Effort", CLAUDE_EFFORTS.map((e) => ({ label: e, value: e, current: e === effort })), { kind: "send", template: "/effort {}" })));
    } else if (tg.kind === "pi") {
      const level = d?.effort?.level;
      const models = d?.models ?? [];
      left.child(pill("model", "π", d?.model?.display_name ?? "pi", t.accent,
        d ? "Model: choose another" : "pi: add mods/agent-bar/pi-agent-bar.ts to ~/.pi/agent/extensions for model and context",
        models.length ? () => this.pick("Model", models.map((m) => ({ ...m, current: m.value === d.model?.id })), { kind: "send", template: "/herdr-model {}" }) : null));
      if (level) left.child(pill("effort", "◐", level, t.ansi13, "Thinking: choose a level", () =>
        this.pick("Thinking", (d.levels ?? []).map((l) => ({ label: l, value: l, current: l === level })), { kind: "send", template: "/herdr-thinking {}" })));
    } else {
      left.child(pill("shell", "$", tg.shell, t.ansi10, "Shell: start an agent here", () =>
        this.pick(tg.shell, [
          { label: "Start Claude Code", value: "claude" },
          { label: "Start pi", value: "pi" },
          { label: "Clear", value: "clear" },
        ], { kind: "send", template: "{}", idle: false })));
    }

    const ctx = d?.context_window?.used_percentage;
    if (ctx != null) left.child(pill("ctx", "▤", `${ctx}%`, hot(ctx),
      `Context: ${d.context_window.total_input_tokens ?? "?"} of ${d.context_window.context_window_size ?? "?"} tokens`,
      () => this.pick("Context", tg.kind === "claude"
        ? [{ label: "Show usage", value: "/context" }, { label: "Compact", value: "/compact" }, { label: "Clear", value: "/clear" }]
        : [{ label: "Compact", value: "/compact" }, { label: "New session", value: "/new" }], { kind: "send", template: "{}" })));

    if (g) left.child(pill("branch", "⎇", g.branch, t.ansi12, "Branch: switch", () =>
      openOverlay({ mod: "agent-bar-pick", kind: "popup", frame: "none", width: 300, height: 380,
        props: { title: "Branch", items: null, action: { kind: "branch", cwd, on: tg.machine } } })));
    if (g && (g.add || g.del)) left.child(
      h_flex().id("ab-diff").flex_none().h(24).px(10).gap(6).items_center().rounded(8).bg(glass(t.background))
        .tooltip("Changes: open the changes panel").cursor_pointer().hover((h) => h.bg(t.hover))
        .on_click(() => this.panel("changes"))
        .child(h_flex().text_color(t.done).child(`+${g.add}`))
        .child(h_flex().text_color(t.blocked).child(`−${g.del}`)));
    if (cwd) left.child(pill("cwd", "▸", short(tg.machine ? cwd : tilde(cwd, this.home)), t.ansi11,
      `${tg.machine ? tg.machine + ":" : ""}${cwd}\nClick for the files panel`, () => this.panel("files")));

    if (tg.kind === "claude" && d) {
      const style = d.output_style?.name, cost = d.cost?.total_cost_usd, five = d.rate_limits?.five_hour?.used_percentage;
      if (style) right.child(pill("style", "¶", style, t.ansi14, "Output style: choose another", () =>
        this.pick("Output style", this.styles.map((s) => ({ label: s, value: s, current: s === style })), { kind: "send", template: "/output-style {}" })));
      if (cost != null) right.child(pill("cost", "$", cost.toFixed(2), t.ansi10, "Session cost: show usage", () =>
        this.pick("Usage", [{ label: "Cost", value: "/cost" }, { label: "Usage limits", value: "/usage" }], { kind: "send", template: "{}" })));
      if (five != null) right.child(pill("5h", "◷", `${five}%`, hot(five), "5-hour limit used", null));
    }
    if (tg.machine) right.child(pill("machine", "⌂", tg.machine, t.dim, "Remote terminal", null));

    return root.child(left).child(right);
  }
}
