// Claude Code usage, sleek style: a soft card at the bottom of the sidebar with the 5-hour, 7-day
// and Fable limits as thin bars, and today's tokens and API-equivalent cost. usage.py reads the
// transcripts; this mod asks it again every `usage_minutes` minutes (rice.json usage.minutes, set in
// my-settings "Check every", else settings.json morph.usage_minutes; default 5).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec, appHome, layout, readTextFile, run, shared } from "herdr";
import { box, bar, fit, pctColor, SANS } from "./box.js";

const DEFAULT_MINUTES = 5;
const TICK_MS = 15000; // how often the mod checks whether the interval has passed
const MONO = "Geist Mono";
const COST_TIP = "API-equivalent cost at Anthropic list prices, not what a subscription is billed";
const R = (k, d) => (shared("rice") ?? {})[k] ?? d;

const fmtTokens = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + "B" : n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? Math.round(n / 1e3) + "k" : String(n));
const money = (x) => (x >= 100 ? "$" + Math.round(x) : x >= 10 ? "$" + x.toFixed(1) : "$" + x.toFixed(2));

function untilText(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h${String(m % 60).padStart(2, "0")}`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24 ? `${h % 24}h` : ""}`;
}

// How often the usage checks run (default 5, at least 1).
async function usageMinutes() {
  for (const [file, pick] of [["rice.json", (d) => d?.["usage.minutes"]], ["settings.json", (d) => d?.morph?.usage_minutes]]) {
    try {
      const text = await readTextFile(`${appHome()}/${file}`);
      const n = Number(text ? pick(JSON.parse(text)) : NaN);
      if (Number.isFinite(n) && n > 0) return Math.max(1, n);
    } catch {}
  }
  return DEFAULT_MINUTES;
}

export default class ClaudeUsage extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.lastRun = 0;
    this.folded = localStorage.getItem("folded") === "1";
    this.load(cx);
    cx.timer.every(TICK_MS, (cx) => this.load(cx));
  }

  // Runs usage.py only when the configured interval has passed since the last run.
  load(cx) {
    cx.spawn(async (cx) => {
      const minutes = await usageMinutes();
      if (Date.now() - this.lastRun < minutes * 60000) return;
      this.lastRun = Date.now();
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/claude-usage/usage.py`], { timeout: 20000 });
        if (r.code !== 0) throw new Error((r.stderr || "usage.py failed").split("\n").slice(-2).join(" "));
        this.data = JSON.parse(r.stdout);
        this.error = null;
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.fit();
      cx.notify();
    });
  }

  // Limits to show: each with its used percent and reset time.
  rows() {
    const d = this.data;
    const limits = d?.limits && !d.limits.error ? d.limits : {};
    const now = Date.now();
    return [["5h", limits.session], ["7d", limits.weekly], ["Fable", limits.fable]]
      .filter(([, l]) => l)
      .map(([name, l]) => {
        const resets = l.resets_at ? Math.round((Date.parse(l.resets_at) - now) / 1000) : null;
        return { name, used: Math.max(0, Math.min(100, Number(l.used) || 0)), resets };
      });
  }

  // Block height: the header plus one line per limit and a footer line for today.
  fit() {
    const on = R("usage.claude", true) !== false && R("sidebar.usage", true) !== false;
    const n = this.rows().length;
    const px = !on ? 0 : this.folded ? 40 : 40 + 22 + n * 20 + 20;
    fit(layout, run, "usage", px);
  }

  render() {
    const t = theme();
    if (R("usage.claude", true) === false) return div();
    const d = this.data;
    const rows = this.rows();
    const top = rows[0];
    const summary = [
      div().font_family(MONO).text_size(11).text_color(top ? pctColor(t, top.used) : t.dim)
        .child(top ? `5h ${Math.round(top.used)}%` : this.error ? "—" : "…"),
    ];
    const line = (name, used, resets) => h_flex().h(20).gap(8).items_center().font_family(MONO).text_size(11)
      .child(div().w(34).flex_none().text_color(t.dim).font_family(SANS).child(name))
      .child(bar(t, used, pctColor(t, used)))
      .child(div().w(34).flex_none().text_right().text_color(used >= 85 ? t.blocked : t.foreground).child(`${Math.round(used)}%`))
      .child(div().w(50).flex_none().text_right().whitespace_nowrap().text_color(t.dim)
        .child(resets != null && resets > 0 ? `↻ ${untilText(resets)}` : ""));
    const body = v_flex().gap(2)
      .child(this.error
        ? div().font_family(SANS).text_size(11).text_color(t.dim).child(this.error)
        : !d ? div().font_family(SANS).text_size(11).text_color(t.dim).child("Checking…")
        : v_flex().gap(2).children(rows.map((r) => line(r.name, r.used, r.resets))))
      .when(Boolean(d), (el) => el.child(div().font_family(SANS).text_size(11).text_color(t.dim)
        .tooltip(`Claude Code today: ${d?.sessions} sessions · ${COST_TIP}`)
        .child(`today ${fmtTokens(d?.tokens ?? 0)} tok · ${money(d?.cost ?? 0)}`)));
    return v_flex().id("claude-usage-root").size_full().min_h(0).px(8).pt(8)
      .child(box(t, {
        id: "claude-usage", title: "claude code", open: !this.folded,
        onToggle: (_e, cx) => { this.folded = !this.folded; localStorage.setItem("folded", this.folded ? "1" : "0"); this.fit(); cx.notify(); },
        summary, body,
      }));
  }
}
