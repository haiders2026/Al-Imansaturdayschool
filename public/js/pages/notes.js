import { state, api, esc, fmtDate, studentName, studentById, className, classOptions, emptyState, modal, download, toCSV } from "../core.js";
import { noteForm } from "./student.js";

export async function render(page) {
  const notes = await api("GET", "/notes");
  let cls = "", cat = "", followUp = false;

  page.innerHTML = `
    <div class="page-head"><div><h1>Teacher notes</h1><div class="muted">Every note teachers have written about students. Open a student to add more.</div></div>
      <div class="btn-row"><button class="btn secondary" id="export">Export CSV</button><button class="btn" id="add">+ Add note</button></div></div>
    <div class="card">
      <div class="toolbar">
        <div class="field"><label>Class</label><select id="cls">${classOptions("", { includeAll: true })}</select></div>
        <div class="field"><label>Category</label><select id="cat"><option value="">All</option>${[...new Set(notes.map((n) => n.category || "General"))].map((c) => `<option>${esc(c)}</option>`).join("")}</select></div>
        <label class="check"><input type="checkbox" id="fu"> Needs follow-up only</label>
      </div><div id="list"></div></div>`;

  const filtered = () => notes.filter((n) => {
    const s = studentById(n.studentId);
    return s && (!cls || s.classId === cls) && (!cat || (n.category || "General") === cat) && (!followUp || n.followUp);
  });
  const draw = () => {
    const l = filtered();
    page.querySelector("#list").innerHTML = l.length ? l.map((n) => {
      const s = studentById(n.studentId);
      return `<div class="list-item"><div><a href="#/student/${s.id}/notes"><strong>${esc(studentName(s))}</strong></a> <span class="badge">${esc(className(s.classId))}</span>
        <span class="badge blue">${esc(n.category || "General")}</span>${n.followUp ? ` <span class="badge red">Follow up</span>` : ""}${n.visibleToParent ? ` <span class="badge green">Shared with parents</span>` : ""}</div>
        <div class="note-text" style="margin-top:4px">${esc(n.text)}</div><div class="meta">${esc(n.authorName)} · ${fmtDate(n.createdAt)}</div></div>`;
    }).join("") : emptyState("No notes match.");
  };
  draw();
  page.querySelector("#cls").onchange = (e) => { cls = e.target.value; draw(); };
  page.querySelector("#cat").onchange = (e) => { cat = e.target.value; draw(); };
  page.querySelector("#fu").onchange = (e) => { followUp = e.target.checked; draw(); };
  page.querySelector("#export").onclick = () => download("teacher-notes.csv", toCSV([
    ["Date", "Student", "Class", "Category", "Note", "Author", "Shared with parents", "Follow up"],
    ...filtered().map((n) => { const s = studentById(n.studentId); return [n.createdAt.slice(0, 10), studentName(s), className(s.classId), n.category, n.text, n.authorName, n.visibleToParent ? "yes" : "", n.followUp ? "yes" : ""]; }),
  ]));
  page.querySelector("#add").onclick = () => {
    const students = state.students.filter((s) => s.active !== false).sort((a, b) => studentName(a).localeCompare(studentName(b)));
    const { el, close } = modal({
      title: "Which student?",
      body: `<div class="field"><select id="s"><option value="">Choose…</option>${students.map((s) => `<option value="${s.id}">${esc(studentName(s))} — ${esc(className(s.classId))}</option>`).join("")}</select></div>
        <div class="modal-foot"><button class="btn secondary" data-close>Cancel</button><button class="btn" id="go">Next</button></div>`,
    });
    el.querySelector("#go").onclick = () => { const id = el.querySelector("#s").value; if (!id) return; close(); noteForm(id); };
  };
}
