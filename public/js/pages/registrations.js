import { state, api, esc, appInviteLine, fmtDate, toast, emptyState, modal, confirmBox, loadCommon, waChat, studentName, className, classOptions, onSubmit } from "../core.js";

const STATUS = { pending: ["New", "amber"], approved: ["Added", "green"], declined: ["Declined", "red"] };
const regLink = () => `${location.origin}/register`;
const parents = (f) => [f.fatherName, f.motherName, f.guardianName].filter(Boolean).join(" & ");
const phoneOf = (f) => f.fatherPhone || f.motherPhone || f.guardianPhone || "";

export async function render(page, [filter = "pending"]) {
  const [regs, families] = await Promise.all([api("GET", "/registrations"), filter === "families" ? api("GET", "/registrations/families") : null]);
  const s = state.settings;
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, regs.filter((r) => r.status === k).length]));

  page.innerHTML = `
    <div class="page-head"><div><h1>Registrations</h1><div class="muted">Families sign up online. Check each one, pick the class, and the children are added to Students.</div></div></div>
    <div class="card"><h2>Registration form</h2>
      <p>Share this link with families${s.academicYear ? ` for ${esc(s.academicYear)}` : ""}:</p>
      <div class="btn-row"><input id="link" readonly value="${esc(regLink())}" style="max-width:420px">
        <button class="btn secondary sm" id="copy">Copy link</button>
        <a class="btn wa sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(`As-salamu alaykum! Registration for ${s.schoolName} ${s.academicYear || ""} is open. Please fill in this form for each family: ${regLink()}`)}">Share on WhatsApp</a>
        <a class="btn secondary sm" href="/register" target="_blank" rel="noopener">Open the form</a></div>
      <form id="opts" style="margin-top:14px">
        <label class="check"><input type="checkbox" name="registrationOpen" ${s.registrationOpen !== false ? "checked" : ""}> Registration is open</label>
        <div class="field" style="margin-top:10px"><label>Message at the top of the form (fees, dates, what to bring…)</label>
          <textarea name="registrationNote" rows="3" placeholder="e.g. Classes start Saturday 12 September. The yearly fee is $150 per child plus $25 per book.">${esc(s.registrationNote || "")}</textarea></div>
        <button class="btn sm" type="submit">Save</button></form></div>
    <div class="tabs">${Object.entries(STATUS).map(([k, [l]]) => `<button data-f="${k}" class="${k === filter ? "active" : ""}">${l} (${counts[k]})</button>`).join("")}<button data-f="families" class="${filter === "families" ? "active" : ""}">Enrolled families</button></div>
    <div id="list"></div>`;

  page.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { location.hash = `#/registrations/${b.dataset.f}`; });
  page.querySelector("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(regLink()); toast("Link copied"); }
    catch { page.querySelector("#link").select(); }
  };
  onSubmit(page.querySelector("#opts"), async (v) => {
    state.settings = await api("PUT", "/settings", v);
    toast(v.registrationOpen ? "Saved. Registration is open." : "Saved. Registration is closed.");
  });

  if (families) return drawFamilies(page.querySelector("#list"), families);
  const list = regs.filter((r) => r.status === filter);
  page.querySelector("#list").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Received</th><th>Children</th><th>Parents</th><th>Phone</th><th>Status</th></tr></thead><tbody>
    ${list.map((r) => `<tr class="clickable" data-id="${r.id}"><td>${fmtDate(r.createdAt)}</td>
      <td>${r.children.map((c) => `${esc(c.firstName)} ${esc(c.lastName)} <span class="badge">${esc(c.grade)}</span>${r.status === "pending" && c.matchId ? ` <span class="badge blue">returning</span>` : ""}`).join("<br>")}</td>
      <td>${esc(parents(r.family))}</td><td>${esc(phoneOf(r.family))}</td>
      <td><span class="badge ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card">${emptyState(filter === "pending" ? "No new registrations." : "Nothing here.")}</div>`;
  page.querySelectorAll("tr[data-id]").forEach((tr) => tr.onclick = () => view(regs.find((r) => r.id === tr.dataset.id)));
}

const row = (label, value) => (value ? `<tr><th>${label}</th><td>${esc(value)}</td></tr>` : "");

// Best guess at the class: same name as the grade the family picked.
const guessClass = (grade) => state.classes.find((c) => c.name.toLowerCase() === String(grade || "").toLowerCase())?.id || "";

function view(r) {
  const f = r.family;
  const pending = r.status === "pending";
  const classSelect = (c) => {
    const chosen = guessClass(c.grade) || state.students.find((s) => s.id === c.matchId)?.classId || "";
    return `<select data-class><option value="">Pick a class…</option>${state.classes.map((x) => `<option value="${x.id}" ${x.id === chosen ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select>`;
  };
  const { el, close } = modal({
    title: `Registration ${r.ref || ""}`,
    wide: true,
    body: `<p class="muted small">Received ${fmtDate(r.createdAt)}${r.academicYear ? ` for ${esc(r.academicYear)}` : ""}${r.reviewedBy ? ` · ${STATUS[r.status][0].toLowerCase()} by ${esc(r.reviewedBy)} on ${fmtDate(r.reviewedAt)}` : ""}</p>
      <h3>Children</h3>
      <div class="table-wrap"><table><thead><tr><th>Child</th><th>Details</th>${pending ? "<th>Class</th><th>Books</th><th>Add?</th>" : ""}</tr></thead><tbody>
      ${r.children.map((c, i) => {
        const match = pending && state.students.find((s) => s.id === c.matchId);
        return `<tr data-i="${i}"><td><strong>${esc(c.firstName)} ${esc(c.lastName)}</strong><br><span class="small muted">Asked for: ${esc(c.grade)}</span>
          ${match ? `<br><span class="badge blue">Already a student</span> <span class="small muted">will be updated, not duplicated</span>` : c.returning ? `<br><span class="small muted">Says they attended last year, but no match was found</span>` : ""}</td>
          <td class="small">${[c.gender, c.dob && `Born ${fmtDate(c.dob)}`, c.allergies && `Allergies: ${c.allergies}`, c.medical && `Medical: ${c.medical}`].filter(Boolean).map(esc).join("<br>")}</td>
          ${pending ? `<td>${classSelect(c)}</td><td><select data-books>${[0, 1, 2, 3].map((n) => `<option ${n === (match?.books ?? 1) ? "selected" : ""}>${n}</option>`).join("")}</select></td>
          <td><input type="checkbox" data-add checked></td>` : ""}</tr>`;
      }).join("")}</tbody></table></div>
      <h3 style="margin-top:16px">Family</h3>
      <div class="table-wrap"><table><tbody>
        ${row("Father", [f.fatherName, f.fatherPhone, f.fatherEmail].filter(Boolean).join(" · "))}
        ${row("Mother", [f.motherName, f.motherPhone, f.motherEmail].filter(Boolean).join(" · "))}
        ${row("Guardian", [f.guardianName, f.guardianPhone].filter(Boolean).join(" · "))}
        ${row("Address", f.address)}
        ${row("Emergency", [f.emergencyContact, f.emergencyPhone].filter(Boolean).join(" · "))}
        ${row("Pick-up", f.pickupAuthorized)}
        ${row("Photo consent", r.photoConsent ? "Yes" : "No")}
        ${row("Comments", f.comments)}
      </tbody></table></div>
      ${pending ? `<label class="check" style="margin-top:14px"><input type="checkbox" id="login" checked> Create a parent login (or link these children to the family's existing login)</label>` : ""}
      <div class="modal-foot">
        <button class="btn danger" id="del" style="margin-right:auto">Delete</button>
        ${phoneOf(f) ? `<a class="btn wa" target="_blank" rel="noopener" href="${esc(waChat(phoneOf(f), `As-salamu alaykum, this is ${state.settings.schoolName} about your registration (${r.ref || ""}). `))}">WhatsApp family</a>` : ""}
        ${pending ? `<button class="btn secondary" id="decline">Decline</button><button class="btn" id="approve">Add to students</button>`
          : `<button class="btn secondary" id="reopen">${r.status === "declined" ? "Move back to New" : "Close"}</button>`}
      </div>`,
  });

  el.querySelector("#del").onclick = async () => {
    if (!(await confirmBox("Delete this registration? Students already added stay in Students."))) return;
    await api("DELETE", `/registrations/${r.id}`);
    close();
    window.refreshPage();
  };
  el.querySelector("#decline")?.addEventListener("click", async () => {
    if (!(await confirmBox("Mark this registration as declined?", { okText: "Decline" }))) return;
    await api("POST", `/registrations/${r.id}/status`, { status: "declined" });
    close();
    window.refreshPage();
  });
  el.querySelector("#reopen")?.addEventListener("click", async () => {
    if (r.status === "declined") await api("POST", `/registrations/${r.id}/status`, { status: "pending" });
    close();
    window.refreshPage();
  });
  el.querySelector("#approve")?.addEventListener("click", async (e) => {
    const children = [...el.querySelectorAll("tr[data-i]")].map((tr) => ({
      classId: tr.querySelector("[data-class]").value,
      books: Number(tr.querySelector("[data-books]").value),
      skip: !tr.querySelector("[data-add]").checked,
    }));
    const missing = children.findIndex((c) => !c.skip && !c.classId);
    if (missing >= 0) return toast(`Pick a class for ${r.children[missing].firstName}.`, "error");
    e.target.disabled = true;
    try {
      const res = await api("POST", `/registrations/${r.id}/approve`, { children, createParentLogin: el.querySelector("#login").checked });
      await loadCommon();
      close();
      toast(`${res.studentIds.length} ${res.studentIds.length === 1 ? "child" : "children"} added to Students`);
      if (res.logins.length) showLogins(res.logins, r);
      window.refreshPage();
    } catch (err) {
      toast(err.message, "error");
      e.target.disabled = false;
    }
  });
}

function showLogins(logins, r) {
  modal({
    title: "Parent login created",
    body: `<p>Send these details to the family. They can change the password after signing in.</p>
      ${logins.map((l) => {
        const kids = l.studentIds.map((id) => studentName(state.students.find((s) => s.id === id))).join(", ");
        const msg = `As-salamu alaykum! ${kids} ${l.studentIds.length > 1 ? "are" : "is"} now registered at ${state.settings.schoolName}.\n\n${appInviteLine()}\n\nUsername: ${l.username}\nPassword: ${l.tempPassword}`;
        return `<div class="card" style="box-shadow:none"><strong>${esc(l.name)}</strong><div class="small">Username: <code>${esc(l.username)}</code> · Password: <code>${esc(l.tempPassword)}</code></div>
          <div class="btn-row" style="margin-top:8px"><a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waChat(l.username, msg) || waChat(phoneOf(r.family), msg))}">Send on WhatsApp</a></div></div>`;
      }).join("")}
      <div class="modal-foot"><button class="btn" data-close>Done</button></div>`,
  });
}

// Families already enrolled, with their children, so the office can add a brother or sister in one step.
function drawFamilies(box, families) {
  let q = "";
  const parentsOf = (f) => [f.fatherName, f.motherName, f.guardianName].filter(Boolean).join(" & ") || "No parent name";
  const phoneOfFam = (f) => f.fatherPhone || f.motherPhone || f.guardianPhone || "";
  const sorted = families.sort((a, b) => parentsOf(a).localeCompare(parentsOf(b)));
  box.innerHTML = `<div class="card"><div class="toolbar"><div class="field" style="flex:1"><label>Search</label><input id="fq" placeholder="Parent, child or phone"></div></div>
    <p class="muted small">Every family with a child at the school, grouped by parent phone. Use <strong>Add sibling</strong> to enrol a brother or sister: the parents' details are copied and the child appears on the family's login.</p><div id="ft"></div></div>`;
  const draw = () => {
    const l = sorted.filter((f) => !q || [parentsOf(f), phoneOfFam(f), ...f.children.map((c) => `${c.firstName} ${c.lastName}`)].join(" ").toLowerCase().includes(q));
    box.querySelector("#ft").innerHTML = l.length ? `<div class="table-wrap"><table><thead><tr><th>Family</th><th>Phone</th><th>Children</th><th>Parent login</th><th></th></tr></thead><tbody>
      ${l.map((f) => `<tr style="vertical-align:top"><td><strong>${esc(parentsOf(f))}</strong></td><td>${esc(phoneOfFam(f))}</td>
        <td>${f.children.map((c) => `<a href="#/student/${c.id}">${esc(c.firstName)} ${esc(c.lastName || "")}</a> <span class="muted small">${esc(className(c.classId))}</span>`).join("<br>")}</td>
        <td>${f.login ? `<span class="badge green">${esc(f.login)}</span>` : `<span class="muted small">None yet</span>`}</td>
        <td><button class="btn sm" data-sib="${esc(f.key)}">+ Add sibling</button></td></tr>`).join("")}
      </tbody></table></div>` : emptyState(families.length ? "No family matches." : "No students yet.");
    box.querySelectorAll("[data-sib]").forEach((b) => b.onclick = () => siblingForm(families.find((f) => f.key === b.dataset.sib), parentsOf));
  };
  draw();
  box.querySelector("#fq").oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
}

function siblingForm(f, parentsOf) {
  const lastName = f.children[0]?.lastName || "";
  const { el, close } = modal({
    title: `Add a sibling — ${parentsOf(f)}`,
    body: `<p class="muted small">Already at the school: ${f.children.map((c) => esc(c.firstName)).join(", ")}. Parent names, phones, address and emergency contact are copied from them.</p>
      <form><div class="form-grid">
        <div class="field"><label>First name</label><input name="firstName" required></div>
        <div class="field"><label>Last name</label><input name="lastName" value="${esc(lastName)}"></div>
        <div class="field"><label>Class</label><select name="classId" required><option value="">Pick a class…</option>${classOptions("")}</select></div>
        <div class="field"><label>Books</label><select name="books">${[0, 1, 2, 3].map((n) => `<option ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label>Gender</label><select name="gender"><option value=""></option><option>Male</option><option>Female</option></select></div>
        <div class="field"><label>Date of birth</label><input type="date" name="dob"></div>
        <div class="field"><label>Allergies</label><input name="allergies"></div>
        <div class="field"><label>Medical notes</label><input name="medical"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Add to students</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    const res = await api("POST", "/registrations/families/sibling", { ...v, books: Number(v.books), siblingOf: f.children[0].id });
    await loadCommon();
    close();
    toast(`${res.student.firstName} added${res.logins.length ? ` and linked to the family login (${res.logins.join(", ")})` : ""}`);
    window.refreshPage();
  });
}
