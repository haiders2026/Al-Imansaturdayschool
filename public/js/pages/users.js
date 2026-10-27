import { state, api, esc, studentName, className, toast, emptyState, modal, onSubmit, confirmBox, waChat, download, toCSV } from "../core.js";

const ROLE_LABEL = { admin: "Admin", teacher: "Teacher", parent: "Parent" };

export async function render(page, [tab = "staff"]) {
  const users = await api("GET", "/users");
  const list = users.filter((u) => (tab === "parents" ? u.role === "parent" : u.role !== "parent")).sort((a, b) => a.name.localeCompare(b.name));
  const classesOf = (u) => state.classes.filter((c) => (c.teacherIds || []).includes(u.id)).map((c) => c.name).join(", ");

  page.innerHTML = `
    <div class="page-head"><div><h1>Staff & logins</h1><div class="muted">Teachers see only their own classes. Parents see only their own children.</div></div>
      <div class="btn-row">${tab === "parents" ? `<button class="btn secondary" id="gen">Create logins for all families</button>` : ""}<button class="btn" id="add">+ Add ${tab === "parents" ? "parent" : "staff"} login</button></div></div>
    <div class="tabs"><button data-t="staff" class="${tab === "staff" ? "active" : ""}">Admins & teachers</button><button data-t="parents" class="${tab === "parents" ? "active" : ""}">Parents (${users.filter((u) => u.role === "parent").length})</button></div>
    <div class="card">${list.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>${tab === "parents" ? "Children" : "Classes"}</th><th>Phone</th><th></th></tr></thead><tbody>
      ${list.map((u) => `<tr><td><strong>${esc(u.name)}</strong> ${u.active === false ? `<span class="badge red">Disabled</span>` : ""}</td><td>${esc(u.username)}</td><td><span class="badge ${u.role === "admin" ? "amber" : u.role === "teacher" ? "blue" : ""}">${ROLE_LABEL[u.role]}</span></td>
        <td class="small">${esc(u.role === "parent" ? (u.studentIds || []).map((id) => studentName(state.students.find((s) => s.id === id))).join(", ") : classesOf(u))}</td>
        <td>${esc(u.phone || "")}</td><td><button class="btn sm secondary" data-edit="${u.id}">Edit</button></td></tr>`).join("")}
    </tbody></table></div>` : emptyState(tab === "parents" ? "No parent logins yet. Use “Create logins for all families” to make one per family phone number." : "No staff yet.")}
    ${tab === "staff" ? `<p class="muted small">To assign a teacher to a grade, go to <a href="#/classes">Grades & WhatsApp</a> → Edit.</p>` : ""}</div>`;

  page.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { location.hash = `#/users/${b.dataset.t}`; });
  page.querySelector("#add").onclick = () => userForm({ role: tab === "parents" ? "parent" : "teacher" });
  page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => userForm(users.find((u) => u.id === b.dataset.edit)));
  page.querySelector("#gen")?.addEventListener("click", async () => {
    if (!(await confirmBox("Create a parent login for every family that has a phone number on file? Families that already have one are skipped (new children are linked to their existing login).", { okText: "Create logins", danger: false }))) return;
    const { created } = await api("POST", "/users/parents/generate", {});
    showCredentials(created);
  });
}

const loginMessage = (c) => `As-salamu alaykum ${c.name}! You can now follow your child's attendance, grades, assignments and teacher comments at ${location.origin}\n\nUsername: ${c.username}\nPassword: ${c.tempPassword}\n\nPlease change your password after signing in. — ${state.settings.schoolName}`;

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
      ${u.id ? `<label class="check"><input type="checkbox" name="resetPassword"> Reset password (a new one will be shown)</label>
        <label class="check"><input type="checkbox" name="active" ${u.active !== false ? "checked" : ""}> Account active</label>` : `<div class="field"><label>Password (leave blank to generate one)</label><input name="password" minlength="8"></div>`}
      <div class="modal-foot">${u.id && u.id !== state.user.id ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  const form = el.querySelector("form");
  form.elements.role.onchange = (e) => { el.querySelector("#kids").style.display = e.target.value === "parent" ? "" : "none"; };
  onSubmit(form, async (v) => {
    if (v.role !== "parent") delete v.studentIds;
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
