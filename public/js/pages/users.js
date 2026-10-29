import { state, api, esc, appInviteLine, studentName, className, toast, emptyState, modal, onSubmit, confirmBox, waChat, download, toCSV } from "../core.js";

const ROLE_LABEL = { admin: "Admin / office", teacher: "Teacher", assistant: "Assistant teacher", parent: "Parent" };

// Must match TEACHING_MODULES / OFFICE_MODULES on the server.
const MODULES = {
  attendance: "Attendance", grades: "Tests & grades", assignments: "Assignments", lessonplans: "Lesson plans",
  students: "Students", notes: "Teacher notes", reports: "Reports", calendar: "Calendar (add events)",
  documents: "Documents", classes: "Grades & WhatsApp", messages: "Messages to parents", mynotes: "My notes",
  payments: "Payments", registrations: "Registrations",
};
const OFFICE = ["payments", "registrations"];
const modulesFor = (role) => Object.keys(MODULES).filter((m) => role === "admin" || !OFFICE.includes(m));
const accessLabel = (u) => {
  if (u.role === "parent") return "";
  if (!Array.isArray(u.modules)) return u.role === "admin" ? "Full access" : "All teaching modules";
  return u.modules.map((m) => MODULES[m]).filter(Boolean).join(", ") || "No modules";
};

export async function render(page, [tab = "staff"]) {
  const users = await api("GET", "/users");
  const list = users.filter((u) => (tab === "parents" ? u.role === "parent" : u.role !== "parent")).sort((a, b) => a.name.localeCompare(b.name));
  const classesOf = (u) => state.classes.filter((c) => [...(c.teacherIds || []), ...(c.assistantIds || [])].includes(u.id))
    .map((c) => c.name + ((c.assistantIds || []).includes(u.id) ? " (assistant)" : "")).join(", ");

  page.innerHTML = `
    <div class="page-head"><div><h1>Staff & logins</h1><div class="muted">Teachers see only their own classes. Parents see only their own children.</div></div>
      <div class="btn-row">${tab === "parents" ? `<button class="btn secondary" id="gen">Create logins for all families</button>` : ""}<button class="btn" id="add">+ Add ${tab === "parents" ? "parent" : "staff"} login</button></div></div>
    <div class="tabs"><button data-t="staff" class="${tab === "staff" ? "active" : ""}">Admins, teachers & assistants</button><button data-t="parents" class="${tab === "parents" ? "active" : ""}">Parents (${users.filter((u) => u.role === "parent").length})</button></div>
    <div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>${tab === "parents" ? "Children" : "Classes"}</th>${tab === "parents" ? "" : "<th>Can use</th>"}<th>Phone</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td><strong>${esc(u.name)}</strong> ${u.active === false ? `<span class="badge red">Disabled</span>` : ""}</td><td>${esc(u.username)}</td><td><span class="badge ${u.role === "admin" ? "amber" : u.role === "parent" ? "" : "blue"}">${ROLE_LABEL[u.role]}</span></td>
        <td class="small">${esc(u.role === "parent" ? (u.studentIds || []).map((id) => studentName(state.students.find((s) => s.id === id))).join(", ") : classesOf(u))}</td>
        ${tab === "parents" ? "" : `<td class="small">${esc(accessLabel(u))}</td>`}<td>${esc(u.phone || "")}</td><td><button class="btn sm secondary" data-edit="${u.id}">Edit</button></td></tr>`).join("")}
    </tbody></table></div>` : emptyState(tab === "parents" ? "No parent logins yet. Use “Create logins for all families” to make one per family phone number." : "No staff yet.")}
    ${tab === "staff" ? `<p class="muted small">To assign a teacher or assistant teacher to a grade, go to <a href="#/classes">Grades & WhatsApp</a> → Edit.</p>` : ""}</div>`;

  page.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { location.hash = `#/users/${b.dataset.t}`; });
  page.querySelector("#add").onclick = () => userForm({ role: tab === "parents" ? "parent" : "teacher" });
  page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => userForm(users.find((u) => u.id === b.dataset.edit)));
  page.querySelector("#gen")?.addEventListener("click", async () => {
    if (!(await confirmBox("Create a parent login for every family that has a phone number on file? Families that already have one are skipped (new children are linked to their existing login).", { okText: "Create logins", danger: false }))) return;
    const { created } = await api("POST", "/users/parents/generate", {});
    showCredentials(created);
  });
}

const loginMessage = (c) => `As-salamu alaykum ${c.name}! ${appInviteLine()}\n\nUsername: ${c.username}\nPassword: ${c.tempPassword}\n\nPlease change your password after signing in. — ${state.settings.schoolName}`;

function showCredentials(list) {
  const { el } = modal({
    title: list.length ? `${list.length} new login${list.length === 1 ? "" : "s"}` : "Nothing new to create",
    wide: true,
    body: list.length ? `<p class="error-text">Save or send these now. Passwords can't be shown again (you can reset them later).</p>
      <div class="btn-row" style="margin-bottom:10px"><button class="btn secondary sm" id="csv">Download as CSV</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Password</th><th></th></tr></thead><tbody>
      ${list.map((c, i) => `<tr><td>${esc(c.name)}</td><td>${esc(c.username)}</td><td><code>${esc(c.tempPassword)}</code></td><td>${c.phone || /^\d{7,}$/.test(c.username) ? `<a class="btn sm wa" data-i="${i}" target="_blank" rel="noopener">Send</a>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<p>Every family with a phone number already has a login.</p>`,
    onMount: () => {},
  });
  el.querySelectorAll("[data-i]").forEach((a) => a.onclick = () => {
    const c = list[a.dataset.i];
    a.href = waChat(c.phone || c.username, loginMessage(c));
    setTimeout(() => { a.textContent = "✓ Opened"; a.classList.replace("wa", "secondary"); }, 50);
  });
  el.querySelector("#csv")?.addEventListener("click", () => download("new-logins.csv", toCSV([["Name", "Username", "Password"], ...list.map((c) => [c.name, c.username, c.tempPassword])])));
  el.closest(".modal-backdrop").addEventListener("click", (e) => { if (e.target.matches(".modal-backdrop") || e.target.closest("[data-close]")) window.refreshPage(); });
}

function userForm(u) {
  const students = [...state.students].sort((a, b) => studentName(a).localeCompare(studentName(b)));
  const { el, close } = modal({
    title: u.id ? `Edit ${u.name}` : "Add login",
    body: `<form><div class="form-grid">
      <div class="field"><label>Full name</label><input name="name" value="${esc(u.name || "")}" required></div>
      <div class="field"><label>Username</label><input name="username" value="${esc(u.username || "")}" required autocapitalize="none" placeholder="${u.role === "parent" ? "phone number works well" : "e.g. firstname"}"></div>
      <div class="field"><label>Role</label><select name="role">${Object.entries(ROLE_LABEL).map(([k, l]) => `<option value="${k}" ${k === u.role ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="field"><label>Phone (WhatsApp)</label><input name="phone" type="tel" value="${esc(u.phone || "")}"></div>
      <div class="field"><label>Email</label><input name="email" type="email" value="${esc(u.email || "")}"></div></div>
      <div class="field" id="kids" style="${u.role === "parent" ? "" : "display:none"}"><label>Children (hold Ctrl/⌘ to choose several)</label>
        <select name="studentIds" multiple size="8">${students.map((s) => `<option value="${s.id}" ${(u.studentIds || []).includes(s.id) ? "selected" : ""}>${esc(studentName(s))} — ${esc(className(s.classId))}</option>`).join("")}</select></div>
      <fieldset id="access" style="${u.role === "parent" ? "display:none" : ""}"><legend>What can they use?</legend>
        ${u.id && u.id === state.user.id ? `<p class="muted small">You always have full access to your own login.</p>` : `
        <div id="admin-mode"><label class="check"><input type="radio" name="mode" value="full" ${!Array.isArray(u.modules) ? "checked" : ""}> Full access, including staff logins and settings</label>
          <label class="check"><input type="radio" name="mode" value="some" ${Array.isArray(u.modules) ? "checked" : ""}> Only the modules ticked below</label></div>
        <p class="muted small" id="teach-note">Teachers and assistants only ever see their own grade.</p>
        <div class="form-grid" id="mods" style="margin-top:8px">${Object.entries(MODULES).map(([k, l]) => `<label class="check" data-mod="${k}"><input type="checkbox" name="mod_${k}" ${!Array.isArray(u.modules) || u.modules.includes(k) ? "checked" : ""}> ${l}</label>`).join("")}</div>`}
        <p></p></fieldset>
      ${u.id ? `<label class="check"><input type="checkbox" name="resetPassword"> Reset password (a new one will be shown)</label>
        <label class="check"><input type="checkbox" name="active" ${u.active !== false ? "checked" : ""}> Account active</label>` : `<div class="field"><label>Password (leave blank to generate one)</label><input name="password" minlength="8"></div>`}
      <div class="modal-foot">${u.id && u.id !== state.user.id ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  const form = el.querySelector("form");
  const syncAccess = () => {
    const role = form.elements.role.value;
    el.querySelector("#kids").style.display = role === "parent" ? "" : "none";
    el.querySelector("#access").style.display = role === "parent" ? "none" : "";
    const adminMode = el.querySelector("#admin-mode");
    if (!adminMode) return;
    adminMode.style.display = role === "admin" ? "" : "none";
    el.querySelector("#teach-note").style.display = role === "admin" ? "none" : "";
    const full = role === "admin" && form.querySelector("[name=mode][value=full]").checked;
    el.querySelector("#mods").style.display = full ? "none" : "";
    el.querySelectorAll("[data-mod]").forEach((l) => { l.style.display = modulesFor(role).includes(l.dataset.mod) ? "" : "none"; });
  };
  form.addEventListener("change", syncAccess);
  syncAccess();
  onSubmit(form, async (v) => {
    if (v.role !== "parent") delete v.studentIds;
    const modules = modulesFor(v.role).filter((m) => v[`mod_${m}`]);
    Object.keys(v).filter((k) => k.startsWith("mod_")).forEach((k) => delete v[k]);
    if (v.role !== "parent" && el.querySelector("#mods")) v.modules = v.role === "admin" && v.mode === "full" ? null : modules;
    delete v.mode;
    const res = await api("POST", "/users", { ...v, id: u.id });
    close();
    if (res.tempPassword) showCredentials([{ name: res.user.name, username: res.user.username, phone: res.user.phone, tempPassword: res.tempPassword }]);
    else { toast("Saved"); window.refreshPage(); }
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmBox(`Delete the login for ${u.name}?`))) return;
    await api("DELETE", `/users/${u.id}`);
    close();
    window.refreshPage();
  });
}
