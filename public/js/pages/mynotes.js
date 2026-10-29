// A private notebook for each teacher: lesson ideas, reminders, things to follow up. Only the author sees it.
import { state, api, esc, fmtDate, className, classOptions, toast, emptyState, modal, onSubmit, confirmBox } from "../core.js";

export async function render(page) {
  const notes = await api("GET", "/mynotes");
  let q = "";
  page.innerHTML = `
    <div class="page-head"><div><h1>My notes</h1><div class="muted">Your private notebook. Only you can see these notes. Keep lesson ideas, reminders and anything you want to look back on.</div></div>
      <button class="btn" id="new">+ New note</button></div>
    <div class="toolbar"><div class="field" style="flex:1;max-width:420px"><label>Search</label><input id="q" placeholder="Search your notes"></div></div>
    <div id="list"></div>`;
  const draw = () => {
    const l = notes.filter((n) => !q || `${n.title || ""} ${n.text || ""} ${n.tag || ""}`.toLowerCase().includes(q));
    page.querySelector("#list").innerHTML = l.length ? `<div class="grid cols-3">${l.map((n) => `
      <div class="card clickable mynote" data-id="${n.id}">
        <div class="btn-row" style="justify-content:space-between;align-items:flex-start"><h3 style="margin:0">${n.pinned ? "📌 " : ""}${esc(n.title || "Untitled")}</h3></div>
        <div class="btn-row" style="margin:6px 0">${n.classId ? `<span class="badge">${esc(className(n.classId))}</span>` : ""}${n.tag ? `<span class="badge blue">${esc(n.tag)}</span>` : ""}</div>
        <div class="note-text mynote-text">${esc(n.text || "")}</div>
        <div class="meta small muted">${fmtDate(n.updatedAt || n.createdAt)}</div></div>`).join("")}</div>`
      : `<div class="card">${emptyState(notes.length ? "No notes match." : "No notes yet. Click “New note” to start.")}</div>`;
    page.querySelectorAll("[data-id]").forEach((c) => c.onclick = () => form(notes.find((n) => n.id === c.dataset.id)));
  };
  draw();
  page.querySelector("#q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  page.querySelector("#new").onclick = () => form();
}

function form(n = {}) {
  const { el, close } = modal({
    title: n.id ? "Edit note" : "New note",
    wide: true,
    body: `<form>
      <div class="field"><label>Title</label><input name="title" value="${esc(n.title || "")}" placeholder="e.g. Ideas for Surah Al-Fil lesson"></div>
      <div class="form-grid">
        <div class="field"><label>Class (optional)</label><select name="classId"><option value="">—</option>${classOptions(n.classId || "")}</select></div>
        <div class="field"><label>Label (optional)</label><input name="tag" value="${esc(n.tag || "")}" list="note-tags" placeholder="Lesson idea, To do, Follow up…">
          <datalist id="note-tags"><option>Lesson idea</option><option>To do</option><option>Follow up</option><option>Resources</option><option>Parent contact</option></datalist></div>
      </div>
      <div class="field"><label>Note</label><textarea name="text" rows="12">${esc(n.text || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="pinned" ${n.pinned ? "checked" : ""}> Pin to the top</label>
      <div class="modal-foot">${n.id ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}
        <button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    await api("POST", "/mynotes", { ...v, id: n.id });
    toast("Note saved");
    close();
    window.refreshPage();
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmBox("Delete this note?"))) return;
    await api("DELETE", `/mynotes/${n.id}`);
    close();
    window.refreshPage();
  });
}
