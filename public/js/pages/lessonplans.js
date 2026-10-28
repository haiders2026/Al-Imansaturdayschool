import { state, api, esc, fmtDate, classOptions, className, isAdmin, toast, emptyState, modal, onSubmit, confirmBox, fileToBase64, downloadAuthed } from "../core.js";

const MAX_MB = 4;
const STATUS = {
  draft: ["Draft", ""],
  submitted: ["Waiting for review", "amber"],
  approved: ["Approved", "green"],
  changes: ["Needs changes", "red"],
};
const SECTIONS = [
  ["objectives", "Learning objectives", "What should students know or be able to do by the end?"],
  ["activities", "Lesson outline / activities", "Opening dua, recap, main lesson, practice, closing…"],
  ["resources", "Materials & resources", "Books, pages, worksheets, videos…"],
  ["homework", "Homework", ""],
  ["assessment", "How you'll check understanding", "Quiz, recitation, questions…"],
  ["notes", "Other notes", ""],
];

const upcomingSaturday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export async function render(page, [classIdParam = ""]) {
  const plans = await api("GET", `/lessonplans${classIdParam ? `?classId=${classIdParam}` : ""}`);
  const waiting = plans.filter((p) => p.status === "submitted").length;
  let status = isAdmin() && waiting ? "submitted" : "";

  page.innerHTML = `
    <div class="page-head"><div><h1>Lesson plans</h1><div class="muted">${isAdmin() ? `Teachers plan each Saturday's lessons here and send them to you to review.${waiting ? ` <strong>${waiting} waiting for review.</strong>` : ""}` : "Plan each Saturday's lesson and send it to the admin. Only staff can see lesson plans."}</div></div>
      ${state.classes.length ? `<button class="btn" id="new">+ New lesson plan</button>` : ""}</div>
    <div class="card">
      <div class="toolbar">
        <div class="field"><label>Class</label><select id="cls">${classOptions(classIdParam, { includeAll: true })}</select></div>
        <div class="field"><label>Status</label><select id="st"><option value="">All</option>${Object.entries(STATUS).map(([k, [l]]) => `<option value="${k}" ${k === status ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div><div id="list"></div></div>`;

  const draw = () => {
    const l = plans.filter((p) => !status || p.status === status);
    page.querySelector("#list").innerHTML = l.length ? `<div class="table-wrap"><table><thead><tr><th>Week of</th><th>Class</th><th>Lesson</th><th>Teacher</th><th>Status</th></tr></thead><tbody>
      ${l.map((p) => `<tr class="clickable" data-id="${p.id}"><td>${fmtDate(p.weekOf)}</td><td>${esc(className(p.classId))}</td>
        <td><strong>${esc(p.title)}</strong>${p.subject ? ` <span class="badge blue">${esc(p.subject)}</span>` : ""}${p.file ? " 📎" : ""}</td>
        <td>${esc(p.authorName || "")}</td><td><span class="badge ${STATUS[p.status]?.[1] || ""}">${STATUS[p.status]?.[0] || ""}</span></td></tr>`).join("")}
      </tbody></table></div>` : emptyState(plans.length ? "No lesson plans match." : "No lesson plans yet.");
    page.querySelectorAll("tr[data-id]").forEach((r) => r.onclick = () => view(plans.find((p) => p.id === r.dataset.id)));
  };
  draw();
  page.querySelector("#cls").onchange = (e) => { location.hash = `#/lessonplans/${e.target.value}`; };
  page.querySelector("#st").onchange = (e) => { status = e.target.value; draw(); };
  page.querySelector("#new")?.addEventListener("click", () => form({ classId: classIdParam }));
}

function view(p) {
  const [label, color] = STATUS[p.status] || ["", ""];
  const { el, close } = modal({
    title: p.title,
    wide: true,
    body: `<div class="print-only"><h2>${esc(state.settings.schoolName)} — Lesson plan</h2><h3>${esc(p.title)}</h3></div>
      <div class="btn-row" style="margin-bottom:12px"><span class="badge ${color}">${label}</span><span class="badge">${esc(className(p.classId))}</span>${p.subject ? `<span class="badge blue">${esc(p.subject)}</span>` : ""}
        <span class="muted small">Week of ${fmtDate(p.weekOf)} · by ${esc(p.authorName || "")}</span></div>
      ${p.feedback || p.reviewedBy ? `<div class="card" style="background:${p.status === "approved" ? "var(--green-soft)" : "var(--amber-soft)"};box-shadow:none"><strong>Admin feedback</strong>${p.feedback ? `<div class="note-text">${esc(p.feedback)}</div>` : ""}<div class="meta small muted">${esc(p.reviewedBy || "")}${p.reviewedAt ? ` · ${fmtDate(p.reviewedAt)}` : ""}</div></div>` : ""}
      ${SECTIONS.filter(([k]) => p[k]).map(([k, l]) => `<h3 style="margin-top:14px">${l}</h3><div class="note-text">${esc(p[k])}</div>`).join("") || `<p class="muted">No details written yet.</p>`}
      ${p.file || p.link ? `<div class="btn-row" style="margin-top:14px">${p.file ? `<button class="btn sm" id="file">⬇ ${esc(p.file.name)}</button>` : ""}${p.link ? `<a class="btn sm secondary" href="${esc(p.link)}" target="_blank" rel="noopener">Open link</a>` : ""}</div>` : ""}
      ${isAdmin() ? `<fieldset class="no-print" style="margin-top:16px"><legend>Review</legend>
        <div class="field"><label>Feedback for the teacher</label><textarea id="fb">${esc(p.feedback || "")}</textarea></div>
        <div class="btn-row" style="margin-bottom:10px"><button class="btn" data-review="approved">Approve</button><button class="btn danger" data-review="changes">Ask for changes</button></div></fieldset>` : ""}
      <div class="modal-foot no-print"><button class="btn danger" id="del" style="margin-right:auto">Delete</button><button class="btn secondary" id="print">Print</button><button class="btn secondary" id="edit">Edit</button><button class="btn" data-close>Close</button></div>`,
  });
  el.querySelector("#file")?.addEventListener("click", () => downloadAuthed(`/lessonplans/${p.id}/file`, p.file.name));
  el.querySelector("#print").onclick = () => { document.body.classList.add("printing-modal"); print(); document.body.classList.remove("printing-modal"); };
  el.querySelector("#edit").onclick = () => { close(); form(p); };
  el.querySelector("#del").onclick = async () => {
    if (!(await confirmBox(`Delete the lesson plan “${p.title}”?`))) return;
    await api("DELETE", `/lessonplans/${p.id}`);
    close();
    toast("Lesson plan deleted");
    window.refreshPage();
  };
  el.querySelectorAll("[data-review]").forEach((b) => b.onclick = async () => {
    await api("POST", `/lessonplans/${p.id}/review`, { status: b.dataset.review, feedback: el.querySelector("#fb").value });
    close();
    toast(b.dataset.review === "approved" ? "Approved" : "Sent back to the teacher");
    window.refreshPage();
  });
}

function form(p = {}) {
  const { el, close } = modal({
    title: p.id ? "Edit lesson plan" : "New lesson plan",
    wide: true,
    body: `<form><div class="form-grid">
      <div class="field"><label>Class</label><select name="classId" required>${classOptions(p.classId || (state.classes.length === 1 ? state.classes[0].id : ""))}</select></div>
      <div class="field"><label>Week of (Saturday)</label><input type="date" name="weekOf" value="${p.weekOf || upcomingSaturday()}" required></div>
      <div class="field"><label>Subject</label><input name="subject" value="${esc(p.subject || "")}" list="plan-subjects" placeholder="Quran, Arabic, Islamic Studies…"></div></div>
      <datalist id="plan-subjects"><option>Quran</option><option>Arabic</option><option>Islamic Studies</option><option>Seerah</option><option>Hifz</option><option>Akhlaq</option><option>Fiqh</option></datalist>
      <div class="field"><label>Lesson title / topic</label><input name="title" value="${esc(p.title || "")}" required placeholder="e.g. Surah Al-Asr: meaning and memorisation"></div>
      ${SECTIONS.map(([k, l, ph]) => `<div class="field"><label>${l}</label><textarea name="${k}" rows="${k === "activities" ? 6 : 3}" placeholder="${esc(ph)}">${esc(p[k] || "")}</textarea></div>`).join("")}
      <div class="form-grid">
        <div class="field"><label>Attach a file (up to ${MAX_MB} MB)${p.file ? ` — current: ${esc(p.file.name)}` : ""}</label><input type="file" name="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,image/*"></div>
        <div class="field"><label>Or a link</label><input type="url" name="link" value="${esc(p.link || "")}" placeholder="https://"></div></div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn secondary" type="submit" data-status="draft">Save draft</button><button class="btn" type="submit" data-status="submitted">${isAdmin() ? "Save" : "Send to admin"}</button></div></form>`,
  });
  const formEl = el.querySelector("form");
  let status = "submitted";
  formEl.querySelectorAll("[data-status]").forEach((b) => b.addEventListener("click", () => { status = b.dataset.status; }));
  onSubmit(formEl, async (v) => {
    const file = formEl.elements.file.files[0];
    const body = { ...v, id: p.id, status };
    delete body.file;
    if (file) {
      if (file.size > MAX_MB * 1024 * 1024) throw new Error(`That file is too big. Please keep it under ${MAX_MB} MB.`);
      body.file = { name: file.name, type: file.type, data: await fileToBase64(file) };
    }
    await api("POST", "/lessonplans", body);
    toast(status === "draft" ? "Draft saved" : isAdmin() ? "Saved" : "Sent to the admin for review");
    close();
    window.refreshPage();
  });
}
