import { state, api, esc, studentName, className, classOptions, isAdmin, toast, emptyState, modal, onSubmit, download, toCSV, waChat, parentPhone, parentName, loadCommon, waShare } from "../core.js";

export async function render(page) {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  let q = params.get("q") || "";
  let cls = params.get("class") || "";
  let showInactive = false, code = "";

  page.innerHTML = `
    <div class="page-head"><div><h1>Students</h1><div class="muted" id="count"></div></div>
      <div class="btn-row"><button class="btn secondary" id="msg">Message parents</button><button class="btn secondary" id="export">Export CSV</button>${isAdmin() ? `<button class="btn" id="add">+ Add student</button>` : ""}</div></div>
    <div class="card">
      <div class="toolbar">
        <div class="field" style="flex:1"><label>Search</label><input id="q" placeholder="Name, parent, phone…" value="${esc(q)}"></div>
        <div class="field"><label>Class</label><select id="cls">${classOptions(cls, { includeAll: true })}</select></div>
        ${isAdmin() ? `<div class="field"><label>Code</label><select id="code"><option value="">All</option><option>R</option><option>C</option></select></div>
          <label class="check"><input type="checkbox" id="inactive"> Show withdrawn</label>` : ""}
      </div>
      <div id="table"></div>
    </div>`;

  const filtered = () => state.students
    .filter((s) => showInactive || s.active !== false)
    .filter((s) => !cls || s.classId === cls)
    .filter((s) => !code || (s.code || "C") === code)
    .filter((s) => !q || [studentName(s), s.fatherName, s.motherName, s.guardianName, s.fatherPhone, s.motherPhone, s.studentCode].join(" ").toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => className(a.classId).localeCompare(className(b.classId), undefined, { numeric: true }) || studentName(a).localeCompare(studentName(b)));

  const draw = () => {
    const list = filtered();
    page.querySelector("#count").textContent = `${list.length} student${list.length === 1 ? "" : "s"}`;
    page.querySelector("#table").innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th>${isAdmin() ? "<th>Code</th>" : ""}<th>Class</th><th>Parent / guardian</th><th>Phone</th><th></th></tr></thead><tbody>
      ${list.map((s) => `<tr class="clickable" data-id="${s.id}"><td><strong>${esc(studentName(s))}</strong> ${s.active === false ? `<span class="badge red">Withdrawn</span>` : ""}</td>${isAdmin() ? `<td><span class="badge ${s.code === "R" ? "blue" : ""}">${s.code === "R" ? "R" : "C"}</span></td>` : ""}
        <td>${esc(className(s.classId))}</td><td>${esc([s.fatherName, s.motherName].filter(Boolean).join(" / ") || s.guardianName || "")}</td>
        <td>${esc(parentPhone(s))}</td>
        <td>${parentPhone(s) ? `<a class="btn sm wa" href="${waChat(parentPhone(s))}" target="_blank" rel="noopener" onclick="event.stopPropagation()">WhatsApp</a>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : emptyState(state.students.length ? "No students match." : "No students yet. Import your sheet from Settings & Import.");
    page.querySelectorAll("tr[data-id]").forEach((r) => r.onclick = () => { location.hash = `#/student/${r.dataset.id}`; });
  };
  draw();

  page.querySelector("#q").oninput = (e) => { q = e.target.value; draw(); };
  page.querySelector("#cls").onchange = (e) => { cls = e.target.value; draw(); };
  page.querySelector("#code")?.addEventListener("change", (e) => { code = e.target.value; draw(); });
  page.querySelector("#inactive")?.addEventListener("change", (e) => { showInactive = e.target.checked; draw(); });
  page.querySelector("#add")?.addEventListener("click", () => studentForm());
  page.querySelector("#export").onclick = () => {
    const cols = ["firstName", "lastName", "classId", "gender", "dob", "fatherName", "fatherPhone", "fatherEmail", "motherName", "motherPhone", "motherEmail", "guardianName", "guardianPhone", "address", "emergencyContact", "emergencyPhone", "medical", "allergies", ...(isAdmin() ? ["code", "books"] : [])];
    download("students.csv", toCSV([cols.map((c) => (c === "classId" ? "class" : c)), ...filtered().map((s) => cols.map((c) => (c === "classId" ? className(s.classId) : s[c])))]));
  };
  page.querySelector("#msg").onclick = () => messageParents(filtered());
}

// One-by-one WhatsApp messages to each family in the list (WhatsApp doesn't allow bulk sending from a website).
export function messageParents(list) {
  const families = new Map();
  list.forEach((s) => { const p = parentPhone(s); if (p) { if (!families.has(p)) families.set(p, { phone: p, name: parentName(s), kids: [] }); families.get(p).kids.push(s.firstName); } });
  const { el } = modal({
    title: "Message parents on WhatsApp",
    wide: true,
    body: `<div class="field"><label>Message</label><textarea id="m">As-salamu alaykum, this is ${esc(state.settings.schoolName)}. </textarea></div>
      <p class="muted small">WhatsApp only lets websites open one chat at a time. Tap each family below to send; sent ones are ticked off. To reach everyone at once, post in the class WhatsApp group instead.</p>
      <div class="btn-row" style="margin-bottom:10px"><a class="btn wa sm" id="grp" target="_blank" rel="noopener">Post to a group instead</a></div>
      <div>${[...families.values()].map((f, i) => `<div class="list-item btn-row" style="justify-content:space-between"><span>${esc(f.name)} <span class="muted small">(${esc(f.kids.join(", "))}) · ${esc(f.phone)}</span></span>
        <a class="btn sm wa" data-i="${i}" target="_blank" rel="noopener">Send</a></div>`).join("") || emptyState("No parent phone numbers in this list.")}</div>`,
  });
  const fams = [...families.values()];
  const msg = () => el.querySelector("#m").value;
  el.querySelector("#grp").onclick = (e) => { e.currentTarget.href = waShare(msg()); };
  el.querySelectorAll("[data-i]").forEach((a) => a.onclick = () => {
    a.href = waChat(fams[a.dataset.i].phone, msg());
    setTimeout(() => { a.textContent = "✓ Opened"; a.classList.replace("wa", "secondary"); }, 50);
  });
}

export function studentForm(s = {}) {
  const f = (name, label, type = "text", extra = "") => `<div class="field"><label>${label}</label><input type="${type}" name="${name}" value="${esc(s[name] ?? "")}" ${extra}></div>`;
  const { el, close } = modal({
    title: s.id ? `Edit ${studentName(s)}` : "Add student",
    wide: true,
    body: `<form>
      <fieldset><legend>Student</legend><div class="form-grid">
        ${f("firstName", "First name", "text", "required")}${f("lastName", "Last name")}
        <div class="field"><label>Class / grade</label><select name="classId"><option value="">— none —</option>${classOptions(s.classId)}</select></div>
        <div class="field"><label>Gender</label><select name="gender"><option value=""></option>${["Male", "Female"].map((g) => `<option ${s.gender === g ? "selected" : ""}>${g}</option>`).join("")}</select></div>
        ${f("dob", "Date of birth", "date")}${f("studentCode", "Student ID (optional)")}${f("enrolledOn", "Enrolled on", "date")}
      </div></fieldset>
      <fieldset><legend>Parents / guardian</legend><div class="form-grid">
        ${f("fatherName", "Father's name")}${f("fatherPhone", "Father's phone (WhatsApp)", "tel")}${f("fatherEmail", "Father's email", "email")}
        ${f("motherName", "Mother's name")}${f("motherPhone", "Mother's phone (WhatsApp)", "tel")}${f("motherEmail", "Mother's email", "email")}
        ${f("guardianName", "Other guardian")}${f("guardianPhone", "Guardian phone", "tel")}
      </div>${f("address", "Home address")}</fieldset>
      <fieldset><legend>Safety & health</legend><div class="form-grid">
        ${f("emergencyContact", "Emergency contact")}${f("emergencyPhone", "Emergency phone", "tel")}${f("pickupAuthorized", "Allowed to pick up")}
        ${f("allergies", "Allergies")}${f("medical", "Medical notes")}
      </div><label class="check"><input type="checkbox" name="photoConsent" ${s.photoConsent ? "checked" : ""}> Photo consent given</label></fieldset>
      ${isAdmin() ? `<fieldset><legend>Office only</legend><div class="form-grid">
        <div class="field"><label>Code (private)</label><select name="code"><option value="C" ${s.code !== "R" ? "selected" : ""}>C</option><option value="R" ${s.code === "R" ? "selected" : ""}>R</option></select></div>
        <div class="field"><label>Books</label><select name="books">${[0, 1, 2, 3].map((n) => `<option ${n === (s.books ?? 1) ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        ${f("fee", `Base fee override (${esc(state.settings.currency || "$")}) — blank uses the normal fee`, "number", 'step="0.01" min="0"')}
      </div><div class="field"><label>Admin note (not shown to teachers or parents)</label><textarea name="adminNote">${esc(s.adminNote || "")}</textarea></div>
      <label class="check"><input type="checkbox" name="active" ${s.active !== false ? "checked" : ""}> Currently enrolled</label></fieldset>` : ""}
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    const saved = await api("POST", "/students", { ...v, id: s.id, fee: v.fee === "" ? null : v.fee });
    await loadCommon();
    toast("Saved");
    close();
    if (!s.id) location.hash = `#/student/${saved.id}`; else window.refreshPage();
  });
}
