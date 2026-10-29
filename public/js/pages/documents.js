import { state, api, esc, fmtDate, isAdmin, isStaff, can, className, classOptions, toast, emptyState, modal, onSubmit, confirmBox, fileToBase64, downloadAuthed, openAuthed, waShare } from "../core.js";

const MAX_MB = 4;
const CATEGORIES = ["Forms", "Policies", "Newsletters", "Curriculum & syllabus", "Timetables", "Other"];
const AUDIENCE = { all: "Everyone (staff and parents)", staff: "Teachers and staff only", admin: "Admins only", class: "One grade (its teachers and parents)" };
const audienceLabel = (d) => (d.audience === "class" ? className(d.classId) : { all: "Everyone", staff: "Staff only", admin: "Admins only" }[d.audience]);
const sizeText = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function render(page) {
  const docs = await api("GET", "/documents");
  const canUpload = isStaff() && can("documents") && (isAdmin() || state.classes.length);
  let cat = "";
  let q = "";
  page.innerHTML = `
    <div class="page-head"><div><h1>Documents</h1><div class="muted">${isStaff() ? "Upload PDFs such as forms, policies and newsletters, and choose who can see each one." : "Forms, newsletters and other files from the school."}</div></div>
      ${canUpload ? `<button class="btn" id="new">+ Upload document</button>` : ""}</div>
    <div class="card">
      <div class="toolbar"><div class="field" style="flex:1"><label>Search</label><input id="q" placeholder="Title or description"></div>
        <div class="field"><label>Category</label><select id="cat"><option value="">All</option>${[...new Set([...CATEGORIES, ...docs.map((d) => d.category).filter(Boolean)])].map((c) => `<option>${esc(c)}</option>`).join("")}</select></div></div>
      <div id="list"></div></div>`;

  const draw = () => {
    const l = docs.filter((d) => (!cat || d.category === cat) && (!q || `${d.title} ${d.description || ""}`.toLowerCase().includes(q)));
    page.querySelector("#list").innerHTML = l.length ? l.map((d) => `<div class="list-item"><div class="btn-row" style="justify-content:space-between;align-items:flex-start">
        <div><strong>📄 ${esc(d.title)}</strong> ${d.category ? `<span class="badge blue">${esc(d.category)}</span>` : ""} ${isStaff() ? `<span class="badge ${d.audience === "all" ? "green" : d.audience === "class" ? "" : "amber"}">${esc(audienceLabel(d))}</span>` : ""}
          ${d.description ? `<div class="note-text">${esc(d.description)}</div>` : ""}
          <div class="meta">${esc(d.file?.name || "")}${d.file?.size ? ` · ${sizeText(d.file.size)}` : ""} · ${esc(d.uploadedBy || "")} · ${fmtDate(d.updatedAt || d.createdAt)}</div></div>
        <div class="btn-row"><button class="btn sm" data-open="${d.id}">Open</button><button class="btn sm secondary" data-dl="${d.id}">Download</button>
          ${isStaff() && d.audience !== "admin" && d.audience !== "staff" ? `<a class="btn sm wa" target="_blank" rel="noopener" href="${esc(waShare(`📄 *${d.title}*${d.description ? `\n${d.description}` : ""}\n\nOpen it in the school app (sign in first): ${location.origin}/#/documents\n\n— ${state.settings.schoolName}`))}">Share</a>` : ""}
          ${canEdit(d) ? `<button class="btn sm secondary" data-edit="${d.id}">Edit</button><button class="btn sm danger" data-del="${d.id}">Delete</button>` : ""}</div></div></div>`).join("")
      : emptyState(docs.length ? "No documents match." : "No documents yet.");
    const find = (id) => docs.find((d) => d.id === id);
    page.querySelectorAll("[data-open]").forEach((b) => b.onclick = () => { const d = find(b.dataset.open); openAuthed(`/documents/${d.id}/file`, d.file.name); });
    page.querySelectorAll("[data-dl]").forEach((b) => b.onclick = () => { const d = find(b.dataset.dl); downloadAuthed(`/documents/${d.id}/file`, d.file.name); });
    page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => form(find(b.dataset.edit)));
    page.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
      const d = find(b.dataset.del);
      if (!(await confirmBox(`Delete “${d.title}”?`))) return;
      await api("DELETE", `/documents/${d.id}`);
      toast("Deleted");
      window.refreshPage();
    });
  };
  draw();
  page.querySelector("#q").oninput = (e) => { q = e.target.value.trim().toLowerCase(); draw(); };
  page.querySelector("#cat").onchange = (e) => { cat = e.target.value; draw(); };
  page.querySelector("#new")?.addEventListener("click", () => form());
}

const canEdit = (d) => can("documents") && (isAdmin() || d.uploadedById === state.user.id);

function form(d = {}) {
  const audiences = isAdmin() ? Object.entries(AUDIENCE) : [["class", AUDIENCE.class]];
  const { el, close } = modal({
    title: d.id ? "Edit document" : "Upload document",
    body: `<form>
      <div class="field"><label>File (PDF preferred, up to ${MAX_MB} MB)${d.file ? ` — current: ${esc(d.file.name)}` : ""}</label><input type="file" name="file" accept=".pdf,application/pdf,image/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx" ${d.id ? "" : "required"}></div>
      <div class="field"><label>Title</label><input name="title" value="${esc(d.title || "")}" required placeholder="e.g. Permission slip, School policy 2026"></div>
      <div class="form-grid">
        <div class="field"><label>Category</label><input name="category" list="doc-cats" value="${esc(d.category || "")}"><datalist id="doc-cats">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join("")}</datalist></div>
        <div class="field"><label>Who can see it?</label><select name="audience">${audiences.map(([k, l]) => `<option value="${k}" ${k === (d.audience || (isAdmin() ? "all" : "class")) ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field" id="cls"><label>Grade</label><select name="classId">${classOptions(d.classId || state.classes[0]?.id || "")}</select></div>
      </div>
      <div class="field"><label>Description (optional)</label><textarea name="description" rows="2">${esc(d.description || "")}</textarea></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">${d.id ? "Save" : "Upload"}</button></div></form>`,
  });
  const f = el.querySelector("form");
  const sync = () => { el.querySelector("#cls").style.display = f.elements.audience.value === "class" ? "" : "none"; };
  f.elements.audience.onchange = sync;
  sync();
  f.elements.file.onchange = () => {
    const file = f.elements.file.files[0];
    if (file && !f.elements.title.value) f.elements.title.value = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  };
  onSubmit(f, async (v) => {
    const file = f.elements.file.files[0];
    const body = { ...v, id: d.id };
    delete body.file;
    if (file) {
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`That file is too big. Please keep it under ${MAX_MB} MB.`);
      body.file = { name: file.name, type: file.type, data: await fileToBase64(file) };
    }
    await api("POST", "/documents", body);
    toast(d.id ? "Saved" : "Uploaded");
    close();
    window.refreshPage();
  });
}
