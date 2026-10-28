import { state, api, esc, fmtDate, today, classOptions, className, isStaff, isAdmin, toast, emptyState, modal, onSubmit, confirmBox, fileToBase64, downloadAuthed, waShare } from "../core.js";

const MAX_MB = 4;

export async function render(page, [classIdParam]) {
  const classId = classIdParam || "";
  const list = await api("GET", `/assignments${classId ? `?classId=${classId}` : ""}`);
  const now = today();

  page.innerHTML = `
    <div class="page-head"><div><h1>Assignments</h1><div class="muted">${isStaff() ? "Upload homework and worksheets for your class. Parents can download them." : "Homework and worksheets from your child's teacher."}</div></div>
      ${isStaff() && state.classes.length ? `<button class="btn" id="new">+ New assignment</button>` : ""}</div>
    <div class="card">
      <div class="toolbar"><div class="field"><label>Class</label><select id="cls">${classOptions(classId, { includeAll: true })}</select></div></div>
      ${list.length ? list.map((a) => item(a, now)).join("") : emptyState("No assignments yet.")}
    </div>`;

  page.querySelector("#cls").onchange = (e) => { location.hash = `#/assignments/${e.target.value}`; };
  page.querySelector("#new")?.addEventListener("click", () => form(classId));
  page.querySelectorAll("[data-file]").forEach((b) => b.onclick = () => {
    const a = list.find((x) => x.id === b.dataset.file);
    downloadAuthed(`/assignments/${a.id}/file`, a.file.name);
  });
  page.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this assignment and its file?"))) return;
    await api("DELETE", `/assignments/${b.dataset.del}`);
    toast("Deleted");
    window.refreshPage();
  });
  page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => form(classId, list.find((x) => x.id === b.dataset.edit)));
}

function item(a, now) {
  const overdue = a.dueDate && a.dueDate < now;
  const canEdit = isAdmin() || a.createdById === state.user.id || (isStaff() && state.classes.some((c) => c.id === a.classId));
  const shareText = `📚 *New assignment – ${className(a.classId)}*\n${a.title}${a.dueDate ? `\nDue: ${fmtDate(a.dueDate)}` : ""}${a.description ? `\n\n${a.description}` : ""}${a.link ? `\n${a.link}` : ""}\n\nDownload it in the school app: ${location.origin}/#/assignments/${a.classId}`;
  return `<div class="list-item">
    <div class="btn-row" style="justify-content:space-between;align-items:flex-start">
      <div><strong>${esc(a.title)}</strong> <span class="badge">${esc(className(a.classId))}</span> ${a.subject ? `<span class="badge blue">${esc(a.subject)}</span>` : ""}
        ${a.dueDate ? `<span class="badge ${overdue ? "" : "amber"}">Due ${fmtDate(a.dueDate)}</span>` : ""}</div>
      <div class="btn-row">
        ${a.file ? `<button class="btn sm" data-file="${a.id}">⬇ ${esc(a.file.name)}</button>` : ""}
        ${a.link ? `<a class="btn sm secondary" href="${esc(a.link)}" target="_blank" rel="noopener">Open link</a>` : ""}
        ${isStaff() ? `<a class="btn sm wa" href="${waShare(shareText)}" target="_blank" rel="noopener">Share to WhatsApp</a>` : ""}
        ${canEdit && isStaff() ? `<button class="btn sm secondary" data-edit="${a.id}">Edit</button><button class="btn sm danger" data-del="${a.id}">Delete</button>` : ""}
      </div></div>
    ${a.description ? `<div class="note-text" style="margin-top:6px">${esc(a.description)}</div>` : ""}
    <div class="meta">Posted by ${esc(a.createdBy || "")} · ${fmtDate(a.createdAt)}</div></div>`;
}

function form(classId, a = {}) {
  const { el, close } = modal({
    title: a.id ? "Edit assignment" : "New assignment",
    body: `<form><div class="form-grid">
      <div class="field"><label>Class</label><select name="classId" required>${classOptions(a.classId || classId)}</select></div>
      <div class="field"><label>Subject</label><input name="subject" value="${esc(a.subject || "")}"></div>
      <div class="field"><label>Due date</label><input type="date" name="dueDate" value="${a.dueDate || ""}" min="${a.id ? "" : today()}"></div></div>
      <div class="field"><label>Title</label><input name="title" value="${esc(a.title || "")}" required></div>
      <div class="field"><label>Instructions</label><textarea name="description">${esc(a.description || "")}</textarea></div>
      <div class="field"><label>Attach a file (PDF, Word, image… up to ${MAX_MB} MB)${a.file ? ` — current: ${esc(a.file.name)}` : ""}</label><input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*,audio/*"></div>
      <div class="field"><label>Or a link (Google Drive, YouTube…)</label><input type="url" name="link" value="${esc(a.link || "")}" placeholder="https://"></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">${a.id ? "Save" : "Upload"}</button></div></form>`,
  });
  const formEl = el.querySelector("form");
  onSubmit(formEl, async (v) => {
    const file = formEl.elements.file.files[0];
    const body = { ...v, id: a.id };
    delete body.file;
    if (file) {
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`That file is too big. Please keep it under ${MAX_MB} MB.`);
      body.file = { name: file.name, type: file.type, data: await fileToBase64(file) };
    }
    await api("POST", "/assignments", body);
    toast(a.id ? "Saved" : "Assignment posted");
    close();
    window.refreshPage();
  });
}
