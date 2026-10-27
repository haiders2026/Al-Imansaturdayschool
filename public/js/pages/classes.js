import { state, api, esc, fmtMoney, isAdmin, isParent, isStaff, toast, emptyState, modal, onSubmit, confirmBox, waChat, waShare, parentPhone, parentName, loadCommon } from "../core.js";

export async function render(page) {
  const teachers = isStaff() ? await api("GET", "/teachers") : [];
  const tName = (id) => teachers.find((t) => t.id === id)?.name || "";
  const classes = state.classes;

  page.innerHTML = `
    <div class="page-head"><div><h1>${isParent() ? "Class WhatsApp groups" : "Grades & WhatsApp groups"}</h1>
      <div class="muted">${isParent() ? "Join your child's class group to get updates from the teacher." : "Each grade has its own parents' WhatsApp group. Paste the group's invite link here, then send it to every family in one place."}</div></div>
      <div class="btn-row">${isStaff() ? `<button class="btn secondary" id="how">How to get an invite link</button>` : ""}${isAdmin() ? `<button class="btn" id="add">+ Add grade/class</button>` : ""}</div></div>
    ${classes.length ? `<div class="grid cols-3">${classes.map((c) => `<div class="card">
      <div class="btn-row" style="justify-content:space-between"><h2 style="margin:0">${esc(c.name)}</h2>${c.whatsappLink ? `<span class="badge green">Group linked</span>` : isStaff() ? `<span class="badge amber">No group yet</span>` : ""}</div>
      ${isStaff() ? `<p class="muted small" style="margin:.5rem 0">${c.studentCount} students · ${esc((c.teacherIds || []).map(tName).filter(Boolean).join(", ") || "No teacher assigned")}${c.room ? ` · Room ${esc(c.room)}` : ""}${isAdmin() && c.fee ? ` · Fee ${fmtMoney(c.fee)}` : ""}</p>` : ""}
      <div class="btn-row">
        ${c.whatsappLink ? `<a class="btn sm wa" href="${esc(c.whatsappLink)}" target="_blank" rel="noopener">${isParent() ? "Join group" : "Open group"}</a>` : ""}
        ${isStaff() && c.whatsappLink ? `<button class="btn sm secondary" data-invite="${c.id}">Invite parents</button><a class="btn sm secondary" href="${waShare("")}" target="_blank" rel="noopener">Post to group</a>` : ""}
        ${isStaff() ? `<button class="btn sm secondary" data-link="${c.id}">${c.whatsappLink ? "Change link" : "Add WhatsApp link"}</button>` : ""}
        ${isAdmin() ? `<button class="btn sm secondary" data-edit="${c.id}">Edit</button>` : ""}
      </div></div>`).join("")}</div>` : `<div class="card">${emptyState(isAdmin() ? "No grades yet. Import your student sheet or add one." : "No classes to show.")}</div>`}`;

  page.querySelector("#add")?.addEventListener("click", () => classForm({}, teachers));
  page.querySelector("#how")?.addEventListener("click", howTo);
  page.querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => classForm(classes.find((c) => c.id === b.dataset.edit), teachers));
  page.querySelectorAll("[data-link]").forEach((b) => b.onclick = () => linkForm(classes.find((c) => c.id === b.dataset.link)));
  page.querySelectorAll("[data-invite]").forEach((b) => b.onclick = () => invite(classes.find((c) => c.id === b.dataset.invite)));
}

function howTo() {
  modal({
    title: "Getting a WhatsApp group invite link",
    body: `<ol>
      <li>In WhatsApp, create a group for the grade (e.g. “Al-Iman Grade 3 Parents”). Add yourself and the teacher.</li>
      <li>Open the group → tap the group name → <strong>Invite via link</strong> (or <em>Invite to group via link</em>).</li>
      <li>Tap <strong>Copy link</strong>. It looks like <code>https://chat.whatsapp.com/AbC123…</code></li>
      <li>Come back here, click <strong>Add WhatsApp link</strong> on that grade and paste it.</li>
      <li>Click <strong>Invite parents</strong> to send the link to each family. Parents also see a “Join group” button when they sign in.</li></ol>
      <p class="muted small">Tip: in group settings you can turn on “Approve new participants” and make only admins able to send messages, so it works as an announcement channel.</p>
      <div class="modal-foot"><button class="btn" data-close>Got it</button></div>`,
  });
}

function linkForm(c) {
  const { el, close } = modal({
    title: `WhatsApp group for ${c.name}`,
    body: `<form><div class="field"><label>Group invite link</label><input name="whatsappLink" value="${esc(c.whatsappLink || "")}" placeholder="https://chat.whatsapp.com/..."></div>
      <p class="muted small">Leave empty to remove the link.</p>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    await api("PUT", `/classes/${c.id}/whatsapp`, v);
    await loadCommon();
    toast("WhatsApp link saved");
    close();
    window.refreshPage();
  });
}

function invite(c) {
  const kids = state.students.filter((s) => s.classId === c.id && s.active !== false);
  const families = [];
  kids.forEach((s) => {
    [[s.fatherName, s.fatherPhone], [s.motherName, s.motherPhone], [s.guardianName, s.guardianPhone]].forEach(([name, phone]) => {
      if (!phone) return;
      const f = families.find((x) => x.phone === phone);
      if (f) f.kids.add(s.firstName); else families.push({ name: name || parentName(s), phone, kids: new Set([s.firstName]) });
    });
  });
  const { el } = modal({
    title: `Invite ${c.name} parents`,
    wide: true,
    body: `<div class="field"><label>Message</label><textarea id="m">As-salamu alaykum! Please join the ${esc(c.name)} parents' WhatsApp group for ${esc(state.settings.schoolName)}: ${esc(c.whatsappLink)}</textarea></div>
      <div class="btn-row" style="margin-bottom:8px"><button class="btn sm secondary" id="copy">Copy message</button><span class="muted small">Tap Send for each parent. WhatsApp opens with the message ready.</span></div>
      ${families.map((f, i) => `<div class="list-item btn-row" style="justify-content:space-between"><span>${esc(f.name)} <span class="muted small">(${esc([...f.kids].join(", "))}) · ${esc(f.phone)}</span></span><a class="btn sm wa" data-i="${i}" target="_blank" rel="noopener">Send</a></div>`).join("") || emptyState("No parent phone numbers in this class yet.")}`,
  });
  const msg = () => el.querySelector("#m").value;
  el.querySelector("#copy").onclick = async () => { await navigator.clipboard.writeText(msg()); toast("Copied"); };
  el.querySelectorAll("[data-i]").forEach((a) => a.onclick = () => {
    a.href = waChat(families[a.dataset.i].phone, msg());
    setTimeout(() => { a.textContent = "✓ Opened"; a.classList.replace("wa", "secondary"); }, 50);
  });
}

function classForm(c, teachers) {
  const { el, close } = modal({
    title: c.id ? `Edit ${c.name}` : "Add grade/class",
    body: `<form><div class="form-grid">
      <div class="field"><label>Name</label><input name="name" value="${esc(c.name || "")}" placeholder="e.g. Grade 3" required></div>
      <div class="field"><label>Sort order</label><input type="number" name="order" value="${c.order ?? ""}"></div>
      <div class="field"><label>Room</label><input name="room" value="${esc(c.room || "")}"></div>
      <div class="field"><label>Yearly fee per student (${esc(state.settings.currency || "$")})</label><input type="number" step="0.01" name="fee" value="${c.fee ?? ""}" placeholder="uses school default"></div></div>
      <div class="field"><label>Teachers (hold Ctrl/⌘ to choose several)</label><select name="teacherIds" multiple size="${Math.min(Math.max(teachers.length, 2), 8)}">
        ${teachers.map((t) => `<option value="${t.id}" ${(c.teacherIds || []).includes(t.id) ? "selected" : ""}>${esc(t.name)}${t.role === "admin" ? " (admin)" : ""}</option>`).join("")}</select>
        ${teachers.length ? "" : `<p class="muted small">Add teacher logins in Staff & Logins first.</p>`}</div>
      <div class="field"><label>WhatsApp group invite link</label><input name="whatsappLink" value="${esc(c.whatsappLink || "")}" placeholder="https://chat.whatsapp.com/..."></div>
      <div class="modal-foot">${c.id ? `<button type="button" class="btn danger" id="del" style="margin-right:auto">Delete</button>` : ""}<button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    await api("POST", "/classes", { ...v, id: c.id, order: v.order === "" ? undefined : Number(v.order), fee: v.fee === "" ? null : Number(v.fee) });
    await loadCommon();
    toast("Saved");
    close();
    window.refreshPage();
  });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmBox(`Delete ${c.name}?`))) return;
    try { await api("DELETE", `/classes/${c.id}`); await loadCommon(); close(); window.refreshPage(); }
    catch (err) { toast(err.message, "error"); }
  });
}
