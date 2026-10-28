import { state, api, esc, fmtDate, fmtMoney, today, studentName, isAdmin, isStaff, isParent, toast, emptyState, modal, onSubmit, confirmBox, waChat, letterGrade, STATUS_LABEL } from "../core.js";
import { studentForm } from "./students.js";
import { paymentForm, showReceipt } from "./payments.js";

const NOTE_CATEGORIES = ["General", "Academic", "Behaviour", "Quran / Hifz", "Health", "Praise"];

export async function render(page, [id, tabParam]) {
  const p = await api("GET", `/students/${id}/profile`);
  const s = p.student;
  const tabs = [["overview", "Overview"], ["attendance", "Attendance"], ["grades", "Grades"], ["notes", isParent() ? "Teacher comments" : "Notes"]];
  if (p.finance) tabs.push(["payments", "Payments"]);
  let tab = tabs.some(([k]) => k === tabParam) ? tabParam : "overview";

  page.innerHTML = `
    ${isStaff() ? `<p class="no-print"><a href="#/students">← All students</a></p>` : ""}
    <div class="print-only"><h2>${esc(state.settings.schoolName)} — Student report · ${esc(state.settings.academicYear || "")}</h2></div>
    <div class="page-head"><div><h1>${esc(studentName(s))}</h1>
      <div class="btn-row"><span class="badge green">${esc(p.class?.name || "No class")}</span>${s.active === false ? `<span class="badge red">Withdrawn</span>` : ""}
      ${s.allergies ? `<span class="badge red">Allergy: ${esc(s.allergies)}</span>` : ""}</div></div>
      <div class="btn-row no-print">${isAdmin() ? `<button class="btn secondary" id="edit">Edit</button>` : ""}<button class="btn secondary" id="report">Report card</button></div></div>
    <div class="stats">
      <div class="stat"><div class="label">Attendance</div><div class="value">${p.attendance.rate === null ? "–" : p.attendance.rate + "%"}</div><div class="sub">${p.attendance.counts.P} present · ${p.attendance.counts.A} absent · ${p.attendance.counts.L} late</div></div>
      <div class="stat"><div class="label">Average grade</div><div class="value">${p.average === null ? "–" : `${p.average}% ${letterGrade(p.average)}`}</div><div class="sub">${p.grades.length} tests</div></div>
      ${p.finance && (p.finance.fee || isAdmin()) ? `<div class="stat"><div class="label">Fees</div><div class="value">${fmtMoney(Math.max(p.finance.balance, 0))}</div><div class="sub">${p.finance.balance <= 0 ? "Paid in full" : `owed of ${fmtMoney(p.finance.fee)}`}</div></div>` : ""}
      <div class="stat"><div class="label">${isParent() ? "Comments" : "Notes"}</div><div class="value">${p.notes.length}</div></div>
    </div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join("")}</div>
    <div id="tab"></div>`;

  const draw = () => {
    page.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    const box = page.querySelector("#tab");
    ({ overview, attendance, grades, notes, payments })[tab](box, p);
  };
  page.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, "", `#/student/${id}/${tab}`); draw(); });
  page.querySelector("#edit")?.addEventListener("click", () => studentForm(s));
  page.querySelector("#report").onclick = () => reportCard(p);
  draw();
}

function contact(name, phone, email) {
  if (!name && !phone && !email) return "";
  return `<div class="list-item"><strong>${esc(name || "")}</strong><div class="btn-row small">${phone ? `${esc(phone)} <a class="btn sm wa" href="${waChat(phone)}" target="_blank" rel="noopener">WhatsApp</a> <a class="btn sm secondary" href="tel:${esc(phone)}">Call</a>` : ""}${email ? ` <a href="mailto:${esc(email)}">${esc(email)}</a>` : ""}</div></div>`;
}

function overview(box, { student: s }) {
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : "");
  box.innerHTML = `<div class="grid cols-2">
    <div class="card"><h2>Parents & guardians</h2>
      ${contact(s.fatherName && `Father: ${s.fatherName}`, s.fatherPhone, s.fatherEmail)}${contact(s.motherName && `Mother: ${s.motherName}`, s.motherPhone, s.motherEmail)}${contact(s.guardianName && `Guardian: ${s.guardianName}`, s.guardianPhone)}
      ${s.address ? `<p class="muted small">📍 ${esc(s.address)}</p>` : ""}
      ${!s.fatherName && !s.motherName && !s.guardianName && !s.fatherPhone && !s.motherPhone ? emptyState("No parent details on file.") : ""}</div>
    <div class="card"><h2>Details</h2><dl class="kv">
      ${row("Date of birth", s.dob && fmtDate(s.dob))}${row("Gender", s.gender)}${row("Student ID", s.studentCode)}${row("Enrolled", s.enrolledOn && fmtDate(s.enrolledOn))}
      ${row("Emergency", [s.emergencyContact, s.emergencyPhone].filter(Boolean).join(" · "))}${row("Pick-up", s.pickupAuthorized)}
      ${row("Allergies", s.allergies)}${row("Medical", s.medical)}${row("Photo consent", s.photoConsent ? "Yes" : "")}
      ${isAdmin() ? row("Admin note", s.adminNote) : ""}</dl></div></div>`;
}

function attendance(box, { attendance: a }) {
  box.innerHTML = `<div class="card"><h2>Attendance history</h2>${a.history.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>
    ${a.history.map((h) => `<tr><td>${fmtDate(h.date)}</td><td><span class="cell ${h.status}">${h.status}</span> ${STATUS_LABEL[h.status]}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No attendance recorded yet.")}</div>`;
}

function grades(box, { grades: g }) {
  box.innerHTML = `<div class="card"><h2>Test results</h2>${g.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Test</th><th>Subject</th><th class="num">Score</th><th class="num">%</th><th>Comment</th></tr></thead><tbody>
    ${g.map((x) => `<tr><td>${fmtDate(x.test.date)}</td><td>${esc(x.test.title)}</td><td>${esc(x.test.subject || "")}</td><td class="num">${x.score}/${x.test.maxScore}</td>
      <td class="num"><span class="badge ${x.percent >= (state.settings.passMark || 60) ? "green" : "red"}">${x.percent}% ${letterGrade(x.percent)}</span></td><td>${esc(x.comment)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No grades yet.")}</div>`;
}

function notes(box, p) {
  box.innerHTML = `<div class="card">
    <div class="btn-row" style="justify-content:space-between"><h2 style="margin:0">${isParent() ? "Comments from teachers" : "Teacher notes"}</h2>${isStaff() ? `<button class="btn" id="add-note">+ Add note</button>` : ""}</div>
    ${p.notes.length ? p.notes.map((n) => `<div class="list-item">
      <div class="btn-row" style="justify-content:space-between"><div><span class="badge ${n.category === "Praise" ? "green" : n.category === "Behaviour" ? "amber" : "blue"}">${esc(n.category || "General")}</span>
        ${isStaff() ? (n.visibleToParent ? `<span class="badge green">Shared with parents</span>` : `<span class="badge">Staff only</span>`) : ""} ${n.followUp ? `<span class="badge red">Follow up</span>` : ""}</div>
        ${isAdmin() || n.authorId === state.user.id ? `<div class="btn-row"><button class="btn link small" data-edit="${n.id}">Edit</button><button class="btn link small" data-del="${n.id}">Delete</button></div>` : ""}</div>
      <div class="note-text" style="margin-top:6px">${esc(n.text)}</div>
      <div class="meta">${esc(n.authorName)} · ${fmtDate(n.createdAt)}</div></div>`).join("") : emptyState(isParent() ? "No comments yet." : "No notes yet.")}</div>`;
  box.querySelector("#add-note")?.addEventListener("click", () => noteForm(p.student.id));
  box.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => noteForm(p.student.id, p.notes.find((n) => n.id === b.dataset.edit)));
  box.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this note?"))) return;
    await api("DELETE", `/notes/${b.dataset.del}`);
    window.refreshPage();
  });
}

export function noteForm(studentId, n = {}) {
  const { el, close } = modal({
    title: n.id ? "Edit note" : "Add note",
    body: `<form>
      <div class="field"><label>Category</label><select name="category">${NOTE_CATEGORIES.map((c) => `<option ${c === n.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
      <div class="field"><label>Note</label><textarea name="text" rows="5" required>${esc(n.text || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="visibleToParent" ${n.visibleToParent ? "checked" : ""}> Share with parents (they'll see it in their login)</label>
      <label class="check"><input type="checkbox" name="followUp" ${n.followUp ? "checked" : ""}> Needs follow-up by the office</label>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save note</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    await api("POST", "/notes", { ...v, id: n.id, studentId });
    toast("Note saved");
    close();
    window.refreshPage();
  });
}

function payments(box, p) {
  const f = p.finance;
  box.innerHTML = `<div class="card">
    <div class="btn-row" style="justify-content:space-between"><h2 style="margin:0">Payments</h2>${isAdmin() ? `<button class="btn" id="pay">+ Record payment</button>` : ""}</div>
    <p>Fee: <strong>${fmtMoney(f.fee)}</strong> · Paid: <strong>${fmtMoney(f.paid)}</strong> · Balance: <strong style="color:${f.balance > 0 ? "var(--red)" : "var(--green)"}">${fmtMoney(f.balance)}</strong></p>
    ${f.payments.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Receipt</th><th class="num">Amount</th><th>Method</th><th>Note</th><th></th></tr></thead><tbody>
      ${f.payments.map((x) => `<tr><td>${fmtDate(x.date)}</td><td>${esc(x.receiptNo || "")}</td><td class="num">${fmtMoney(x.amount)}</td><td>${esc(x.method || "")}</td><td>${esc(x.note || "")}</td>
        <td><button class="btn link small" data-receipt="${x.id}">Receipt</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("No payments recorded.")}</div>`;
  box.querySelector("#pay")?.addEventListener("click", () => paymentForm(p.student.id));
  box.querySelectorAll("[data-receipt]").forEach((b) => b.onclick = () => showReceipt(f.payments.find((x) => x.id === b.dataset.receipt), p.student));
}

function reportCard(p) {
  const s = p.student;
  const bySubject = {};
  p.grades.forEach((g) => { const k = g.test.subject || "General"; (bySubject[k] ||= []).push(g.percent); });
  const shared = p.notes.filter((n) => n.visibleToParent).slice(0, 5);
  const { el } = modal({
    title: "Report card",
    wide: true,
    body: `<div style="border:2px solid var(--green);border-radius:12px;padding:20px">
      <div style="text-align:center;margin-bottom:12px"><img src="/logo.png" width="90" alt="Al-Iman logo"><h2 style="margin:6px 0 0">${esc(state.settings.schoolName)}</h2><div class="muted">Student report · ${esc(state.settings.academicYear || "")} · ${fmtDate(today())}</div></div>
      <dl class="kv"><dt>Student</dt><dd><strong>${esc(studentName(s))}</strong></dd><dt>Class</dt><dd>${esc(p.class?.name || "")}</dd>
        <dt>Attendance</dt><dd>${p.attendance.rate === null ? "–" : p.attendance.rate + "%"} (${p.attendance.counts.P} present, ${p.attendance.counts.L} late, ${p.attendance.counts.A} absent, ${p.attendance.counts.E} excused)</dd>
        <dt>Overall</dt><dd>${p.average === null ? "–" : `${p.average}% — ${letterGrade(p.average)}`}</dd></dl>
      <h3 style="margin-top:16px">By subject</h3>
      ${Object.keys(bySubject).length ? `<table><thead><tr><th>Subject</th><th class="num">Tests</th><th class="num">Average</th><th>Grade</th></tr></thead><tbody>
        ${Object.entries(bySubject).map(([k, v]) => { const a = Math.round(v.reduce((x, y) => x + y, 0) / v.length); return `<tr><td>${esc(k)}</td><td class="num">${v.length}</td><td class="num">${a}%</td><td>${letterGrade(a)}</td></tr>`; }).join("")}</tbody></table>` : `<p class="muted">No grades yet.</p>`}
      ${shared.length ? `<h3 style="margin-top:16px">Teacher comments</h3>${shared.map((n) => `<p class="note-text">“${esc(n.text)}” <span class="muted small">— ${esc(n.authorName)}</span></p>`).join("")}` : ""}
      <div style="display:flex;justify-content:space-between;margin-top:36px" class="small"><span>Teacher: ____________________</span><span>Principal: ____________________</span></div></div>
      <div class="modal-foot no-print"><button class="btn" id="print">Print / Save as PDF</button></div>`,
  });
  el.querySelector("#print").onclick = () => { document.body.classList.add("printing-modal"); print(); document.body.classList.remove("printing-modal"); };
}

