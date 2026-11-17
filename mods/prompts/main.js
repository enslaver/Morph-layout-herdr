import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, agents, theme, run, home, checking } from "herdr";

// Claude Code writes its transcript to ~/.claude/projects/<cwd with non-alphanumerics as ->/<session>.jsonl,
// and records each prompt as {"type":"last-prompt","lastPrompt":"..."}. This panel reads the newest
// transcript for each local Claude Code agent's folder, and shows that prompt.

const TAIL_BYTES = 4 * 1024 * 1024;

async function lastPrompt(cwd) {
  const dir = `${home()}/.claude/projects/${cwd.replace(/[^A-Za-z0-9-]/g, "-")}`;
  const newest = await exec("sh", ["-c", 'ls -t "$1"/*.jsonl 2>/dev/null | head -n 1', "sh", dir]);
  const file = newest.stdout.trim();
  if (!file) return null;
  const r = await exec("sh", ["-c", `tail -c ${TAIL_BYTES} "$1" | grep '"type":"last-prompt"' | tail -n 1`, "sh", file]);
  const line = r.stdout.trim();
  if (!line) return null;
  try {
    return JSON.parse(line).lastPrompt ?? null;
  } catch {
    return null;
  }
}

// The folder a terminal's shell is in now (lsof on its process), else the folder the terminal started in.
async function liveFolder(address, fallback) {
  try {
    const got = JSON.parse((await exec("hc", ["get", address])).stdout);
    const r = await exec("lsof", ["-a", "-p", String(got.pid), "-d", "cwd", "-Fn"]);
    const line = r.stdout.split("\n").find((l) => l.startsWith("n"));
    if (line) return line.slice(1);
  } catch {}
  return fallback;
}

export default class LastPrompt extends View {
  init(_props, cx) {
    this.rows = [];
    this.loading = true;
    if (checking()) return;
    cx.timer.every(10000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    const list = agents();
    cx.spawn(async (cx) => {
      const cwds = {};
      const ls = await exec("hc", ["ls", "--json"]);
      try {
        // The folder Claude is in now (its foreground process), not the folder the terminal started in.
        for (const t of JSON.parse(ls.stdout).terminals) cwds[t.address] = t.foreground?.cwd ?? t.cwd;
      } catch {}

      const rows = [];
      for (const a of list) {
        const row = { address: a.address, name: `${a.space_name} · ${a.tab_name}`, status: a.status, prompt: null, note: "" };
        if (a.app !== "claude-code") row.note = "not Claude Code";
        else if (a.address.includes("/")) row.note = "on another machine";
        else if (!cwds[a.address]) row.note = "no folder";
        else {
          try {
            row.prompt = await lastPrompt(await liveFolder(a.address, cwds[a.address]));
          } catch {
            row.note = "could not read transcript";
          }
          if (!row.prompt && !row.note) row.note = "no prompt yet";
        }
        rows.push(row);
      }
      this.rows = rows;
      this.loading = false;
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const dot = (s) => (s === "working" ? t.working : s === "blocked" ? t.blocked : s === "done" ? t.done : t.idle);
    const shown = this.rows.map((r) =>
      v_flex()
        .id(`lp-${r.address}`)
        .gap(4)
        .p(8)
        .rounded(6)
        .border(1)
        .border_color(t.border)
        .hover((s) => s.bg(t.hover))
        .on_click(() => run("agent.focus", { terminal: r.address }))
        .child(
          div()
            .truncate()
            .font_semibold()
            .text_color(r.prompt ? t.foreground : t.dim)
            .child(r.prompt ? r.prompt.replace(/\s+/g, " ").slice(0, 400) : r.note),
        )
        .child(
          h_flex()
            .gap(6)
            .items_center()
            .child(div().text_color(dot(r.status)).child("●"))
            .child(div().flex_1().truncate().text_size(11).text_color(t.muted).child(r.name)),
        ),
    );
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.surface)
      .p(10)
      .gap(8)
      .text_size(12)
      .overflow_y_scrollbar()
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("LAST PROMPT"))
      .children(
        shown.length ? shown : [div().text_color(t.dim).child(this.loading ? "Reading…" : "No agents")],
      );
  }
}
