// Agent bar chooser popup (opened by agent-bar).
// props: { title, items: [{label, value, current?}] | null, action }
//   action.kind "send":   types template ("{}" = value) into action.terminal, only if it's idle
//                         (idle: false types it regardless, for shells).
//   action.kind "branch": lists git branches in action.cwd and switches with git switch.

import { View } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, props, closeOverlay, exec, hc, notify, checking } from "herdr";

export default class Pick extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.title = p.title ?? "Choose";
    this.action = p.action ?? {};
    this.items = p.items ?? [];
    this.sel = Math.max(0, this.items.findIndex((i) => i.current));
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(150, () => this.handle.focus());
    if (this.action.kind === "branch") this.loadBranches(cx);
  }

  loadBranches(cx) {
    cx.spawn(async (cx) => {
      const r = await exec("git", ["branch", "--format=%(HEAD)\t%(refname:short)\t%(committerdate:relative)", "--sort=-committerdate"], { cwd: this.action.cwd, on: this.action.on, timeout: 3000 });
      this.items = r.stdout.split("\n").filter(Boolean).map((l) => {
        const [head, name, when] = l.split("\t");
        return { label: name, value: name, detail: when, current: head === "*" };
      });
      this.sel = Math.max(0, this.items.findIndex((i) => i.current));
      cx.notify();
    });
  }

  choose(item, cx) {
    const a = this.action;
    closeOverlay(props().overlay);
    if (checking() || item.current) return;
    cx.spawn(async () => {
      if (a.kind === "branch") {
        const r = await exec("git", ["switch", item.value], { cwd: a.cwd, on: a.on, timeout: 10000 });
        notify(r.code === 0
          ? { title: `Switched to ${item.value}`, level: "success", timeout: 3 }
          : { title: "git switch failed", body: (r.stderr || r.stdout).trim(), level: "error" });
      } else if (a.kind === "send" && a.terminal) {
        const text = (a.template ?? "{}").replace("{}", item.value);
        const r = await hc(a.idle === false ? ["send", a.terminal, text] : ["send", "--if", "idle", a.terminal, text]);
        if (r.code !== 0) notify({ title: "Agent is busy", body: `Didn't send ${text}: ${(r.stderr || r.stdout).trim()}`, level: "warning" });
      }
    });
  }

  render(cx) {
    const t = theme();
    const rows = this.items.map((it, i) =>
      h_flex().id("pick-" + i).h(28).px(10).gap(8).items_center().rounded(6).cursor_pointer()
        .when(i === this.sel, (el) => el.bg(t.selected))
        .hover((h) => h.bg(t.hover))
        .on_click((_e, cx) => this.choose(it, cx))
        .child(h_flex().w(10).text_color(t.accent).child(it.current ? "●" : ""))
        .child(h_flex().flex_1().min_w(0).truncate().text_color(t.foreground).child(it.label))
        .when(!!it.detail, (el) => el.child(h_flex().flex_none().text_color(t.dim).text_size(10.5).child(it.detail))));
    return v_flex().size_full().p(6).gap(2).rounded(10).border_1().border_color(t.border).bg(t.popover)
      .font_family("Geist Mono").text_size(12)
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        const n = this.items.length;
        if (e.key === "escape") closeOverlay(props().overlay);
        else if (e.key === "down" && n) this.sel = (this.sel + 1) % n;
        else if (e.key === "up" && n) this.sel = (this.sel - 1 + n) % n;
        else if (e.key === "enter" && n) return this.choose(this.items[this.sel], cx), cx.stop_propagation();
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(h_flex().h(26).px(10).items_center().text_color(t.muted).font_family("Geist").child(this.title))
      .child(v_flex().flex_1().min_h(0).overflow_y_scroll().gap(1)
        .children(rows.length ? rows : [h_flex().h(28).px(10).items_center().text_color(t.dim).child("…")]));
  }
}
