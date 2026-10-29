// Messages to parents and staff. Each message is saved so parents can read it in the app, and the
// sender gets a WhatsApp button per family (WhatsApp doesn't allow sending to many people at once).
import { state, api, esc, fmtDate, isAdmin, isParent, isTeacher, can, studentName, className, familyKey, parentName, parentPhone, appInviteLine, toast, emptyState, modal, onSubmit, confirmBox, waChat, waShare } from "../core.js";

export const TYPES = {
  general: "General", announcement: "Announcement", reminder: "Reminder", homework: "Homework", test: "Upcoming test",
  absence: "Absence", behaviour: "Behaviour", praise: "Praise", event: "Event / trip", closure: "No school", fees: "Fees", login: "Login details",
};
const TEACHER_TYPES = ["general", "homework", "test", "absence", "behaviour", "praise", "event", "reminder"];
const ADMIN_TYPES = ["announcement", "general", "reminder", "event", "closure", "fees", "login"];

const TEMPLATES = {
  general: "As-salamu alaykum {parent},\n\n",
  announcement: "As-salamu alaykum {parent},\n\n",
  reminder: "As-salamu alaykum {parent},\n\nA quick reminder: ",
  homework: "As-salamu alaykum {parent},\n\n{child} has homework this week: \n\nPlease help {child} finish it before Saturday. JazakAllahu khayran.",
  test: "As-salamu alaykum {parent},\n\n{child} has a test next Saturday on: \n\nPlease help {child} revise at home.",
  absence: "As-salamu alaykum {parent},\n\n{child} was not in class today. Please let me know the reason. Here is what we covered so {child} can catch up: ",
  behaviour: "As-salamu alaykum {parent},\n\nI wanted to let you know about {child}'s behaviour in class today: \n\nI'd be grateful if we could work on this together.",
  praise: "As-salamu alaykum {parent},\n\nMashaAllah, {child} did really well today: ",
  event: "As-salamu alaykum {parent},\n\nWe have an event coming up: \nDate: \nTime: \nPlease bring: ",
  closure: "As-salamu alaykum {parent},\n\nThere is no school on  because . Classes start again on .",
  fees: "As-salamu alaykum {parent},\n\nThis is a kind reminder that the school fees for {child} are due. Please pay at the office or contact us if you have any questions. JazakAllahu khayran.",
};

const childNames = (kids) => {
  const names = kids.map((k) => k.firstName);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] || "your child";
};
const fill = (text, { parent = "", child = "your child", cls = "" } = {}) =>
  text.replaceAll("{parent}", parent || "").replace(/ ,/g, ",").replaceAll("{child}", child).replaceAll("{class}", cls).replaceAll("{school}", state.settings.schoolName);
const signOff = (m) => `\n\n— ${m.authorName || state.user.name}, ${state.settings.schoolName}${m.inApp !== false ? `\n\n${appInviteLine()}` : ""}`;

// One entry per family (siblings share a parent phone), from the students the sender can see.
function families(studentIds) {
  const map = new Map();
  for (const s of state.students.filter((x) => studentIds.includes(x.id))) {
    const key = familyKey(s);
    if (!map.has(key)) map.set(key, { key, parent: parentName(s), phone: parentPhone(s), kids: [] });
    map.get(key).kids.push(s);
  }
  return [...map.values()].sort((a, b) => a.parent.localeCompare(b.parent));
}

export async function render(page, [tab = ""]) {
  if (isParent()) return renderInbox(page);
  const list = await api("GET", "/messages");
  const sent = list.filter((m) => isAdmin() || m.authorId === state.user.id);
  const received = list.filter((m) => (m.userIds || []).includes(state.user.id));
  tab = tab || "sent";
  page.innerHTML = `
    <div class="page-head"><div><h1>Messages</h1><div class="muted">${isAdmin()
      ? "Send announcements, reminders and login details to the parents or staff you choose."
      : "Write to the parents of your class. Pick a message type to start from, then change the words as you like."}</div></div>
      <div class="btn-row">${isAdmin() && can("users") ? `<button class="btn secondary" id="logins">Send login details</button>` : ""}<button class="btn" id="new">+ New message</button></div></div>
    <div class="tabs"><button data-t="sent" class="${tab === "sent" ? "active" : ""}">${isAdmin() ? "All sent messages" : "Sent by me"} (${sent.length})</button>
      <button data-t="received" class="${tab === "received" ? "active" : ""}">To me (${received.length})</button></div>
    <div class="card">${(tab === "sent" ? sent : received).map((m) => row(m, tab === "sent")).join("") || emptyState(tab === "sent" ? "No messages sent yet." : "No messages for you yet.")}</div>`;
  page.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { location.hash = `#/messages/${b.dataset.t}`; });
  page.querySelector("#new").onclick = () => compose();
  page.querySelector("#logins")?.addEventListener("click", () => compose({ type: "login" }));
  page.querySelectorAll("[data-send]").forEach((b) => b.onclick = () => sendPanel(list.find((m) => m.id === b.dataset.send)));
  page.querySelectorAll("[data-again]").forEach((b) => b.onclick = () => { const m = list.find((x) => x.id === b.dataset.again); compose({ ...m, id: undefined }); });
  page.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this message? Parents will no longer see it in the app."))) return;
    await api("DELETE", `/messages/${b.dataset.del}`);
    window.refreshPage();
  });
}

function recipientsText(m) {
  const fams = families(m.studentIds || []).length;
  const staff = (m.userIds || []).length;
  return [fams && `${fams} ${fams === 1 ? "family" : "families"}`, staff && `${staff} staff`].filter(Boolean).join(" + ") || "—";
}

function row(m, mine) {
  return `<div class="list-item"><div class="btn-row" style="justify-content:space-between;align-items:flex-start">
    <div><span class="badge blue">${esc(TYPES[m.type] || "Message")}</span> <strong>${esc(m.subject || "")}</strong>
      <div class="note-text">${esc(fill(m.body, { parent: "", child: "your child" }).slice(0, 400))}</div>
      <div class="meta">${esc(m.authorName)} · ${fmtDate(m.createdAt)}${mine ? ` · to ${esc(recipientsText(m))}` : ""}${m.inApp === false ? " · WhatsApp only" : ""}</div></div>
    ${mine ? `<div class="btn-row"><button class="btn sm wa" data-send="${m.id}">WhatsApp</button><button class="btn sm secondary" data-again="${m.id}">Reuse</button>
      ${isAdmin() || m.authorId === state.user.id ? `<button class="btn sm danger" data-del="${m.id}">Delete</button>` : ""}</div>` : ""}</div></div>`;
}

async function renderInbox(page) {
  const list = await api("GET", "/messages");
  page.innerHTML = `<div class="page-head"><div><h1>Messages</h1><div class="muted">Messages from the school and your children's teachers.</div></div></div>
    <div class="card">${list.map(inboxItem).join("") || emptyState("No messages yet.")}</div>`;
}

export function inboxItem(m) {
  const kids = state.students.filter((s) => (m.studentIds || []).includes(s.id));
  return `<div class="list-item"><span class="badge blue">${esc(TYPES[m.type] || "Message")}</span> <strong>${esc(m.subject || "")}</strong>
    <div class="note-text">${esc(fill(m.body, { parent: state.user.name.split(" ")[0], child: childNames(kids), cls: kids[0] ? className(kids[0].classId) : "" }))}</div>
    <div class="meta">${esc(m.authorName)}${m.authorRole === "admin" ? " (school office)" : ""} · ${fmtDate(m.createdAt)}</div></div>`;
}

async function compose(prefill = {}) {
  const admin = isAdmin();
  const types = admin ? ADMIN_TYPES.filter((t) => t !== "login" || can("users")) : TEACHER_TYPES;
  const staff = admin ? await api("GET", "/teachers") : [];
  const students = [...state.students].filter((s) => s.active !== false).sort((a, b) => className(a.classId).localeCompare(className(b.classId), undefined, { numeric: true }) || studentName(a).localeCompare(studentName(b)));
  const modes = admin
    ? [["all", "All parents (whole school)"], ["grades", "Parents of chosen grades"], ["families", "Chosen families"], ["staff", "All teachers & staff"], ["people", "Chosen staff"]]
    : [["all", state.classes.length > 1 ? "Parents of all my classes" : "All parents in my class"], ...(state.classes.length > 1 ? [["grades", "Parents of chosen grades"]] : []), ["families", "Chosen students' parents"]];
  const type = prefill.type || types[0];
  const { el, close } = modal({
    title: type === "login" ? "Send login details" : "New message",
    wide: true,
    body: `<form>
      <div class="form-grid">
        <div class="field"><label>Type of message</label><select name="type">${types.map((t) => `<option value="${t}" ${t === type ? "selected" : ""}>${TYPES[t]}</option>`).join("")}</select></div>
        <div class="field"><label>Send to</label><select name="mode">${modes.map(([k, l]) => `<option value="${k}" ${type === "login" && k === "families" ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      <div id="pick-grades" class="field"><label>Grades</label><div class="check-grid">${state.classes.map((c) => `<label class="check"><input type="checkbox" data-grade="${c.id}"> ${esc(c.name)}</label>`).join("")}</div></div>
      <div id="pick-families" class="field"><label>Students (their parents get the message)</label><input id="fam-q" placeholder="Search name…" style="margin-bottom:6px">
        <div class="check-list">${students.map((s) => `<label class="check" data-name="${esc(studentName(s).toLowerCase())}"><input type="checkbox" data-student="${s.id}"> ${esc(studentName(s))} <span class="muted small">${esc(className(s.classId))} · ${esc(parentName(s))}</span></label>`).join("")}</div></div>
      <div id="pick-people" class="field"><label>Staff</label><div class="check-grid">${staff.map((u) => `<label class="check"><input type="checkbox" data-user="${u.id}"> ${esc(u.name)}</label>`).join("")}</div></div>
      <div id="msg-fields">
        <div class="field"><label>Subject (optional)</label><input name="subject" value="${esc(prefill.subject || "")}"></div>
        <div class="field"><label>Message</label><textarea name="body" rows="8">${esc(prefill.body ?? TEMPLATES[type] ?? "")}</textarea>
          <div class="muted small">{parent} and {child} are replaced with each family's names when you send.</div></div>
        <label class="check"><input type="checkbox" name="inApp" ${prefill.inApp === false ? "" : "checked"}> Also show it in the app (parents see it when they log in)</label>
      </div>
      <div id="login-fields"><p class="muted small">Each family gets its own username and password. Families without a login get one now.</p>
        <label class="check"><input type="checkbox" name="reset"> Also make a new password for families who already have a login</label></div>
      <p></p>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Next: send on WhatsApp</button></div></form>`,
  });
  const f = el.querySelector("form");
  let lastType = type;
  const sync = () => {
    const t = f.elements.type.value, mode = f.elements.mode.value;
    const isLogin = t === "login";
    // Logins only go to parents.
    [...f.elements.mode.options].forEach((o) => { o.disabled = isLogin && (o.value === "staff" || o.value === "people"); });
    if (isLogin && (mode === "staff" || mode === "people")) f.elements.mode.value = "families";
    // Praise, absence and behaviour notes are usually about one child, so start with "chosen students".
    if (t !== lastType && ["praise", "absence", "behaviour"].includes(t) && mode === "all") f.elements.mode.value = "families";
    const m = f.elements.mode.value;
    el.querySelector("#pick-grades").style.display = m === "grades" ? "" : "none";
    el.querySelector("#pick-families").style.display = m === "families" ? "" : "none";
    el.querySelector("#pick-people").style.display = m === "people" ? "" : "none";
    el.querySelector("#msg-fields").style.display = isLogin ? "none" : "";
    el.querySelector("#login-fields").style.display = isLogin ? "" : "none";
    el.querySelector(".modal-head h2").textContent = isLogin ? "Send login details" : "New message";
    // Swap in the new type's starting text unless the sender already wrote their own.
    if (t !== lastType && TEMPLATES[t] !== undefined && (!f.elements.body.value.trim() || f.elements.body.value === TEMPLATES[lastType])) f.elements.body.value = TEMPLATES[t];
    lastType = t;
  };
  f.addEventListener("change", sync);
  sync();
  el.querySelector("#fam-q").oninput = (e) => {
    const q = e.target.value.trim().toLowerCase();
    el.querySelectorAll("[data-name]").forEach((l) => { l.style.display = !q || l.dataset.name.includes(q) || l.textContent.toLowerCase().includes(q) ? "" : "none"; });
  };

  onSubmit(f, async (v) => {
    const checked = (attr) => [...el.querySelectorAll(`[data-${attr}]:checked`)].map((i) => i.dataset[attr]);
    const active = students.map((s) => s.id);
    let studentIds = [], userIds = [];
    if (v.mode === "all") studentIds = active;
    if (v.mode === "grades") { const g = checked("grade"); studentIds = students.filter((s) => g.includes(s.classId)).map((s) => s.id); }
    if (v.mode === "families") studentIds = checked("student");
    if (v.mode === "staff") userIds = staff.map((u) => u.id);
    if (v.mode === "people") userIds = checked("user");
    if (!studentIds.length && !userIds.length) throw new Error("Choose who to send it to.");

    if (v.type === "login") {
      const res = await api("POST", "/messages/logins", { studentIds, reset: v.reset });
      close();
      loginPanel(res);
      return;
    }
    const m = await api("POST", "/messages", { type: v.type, subject: v.subject, body: v.body, inApp: v.inApp, studentIds, userIds });
    close();
    toast(v.inApp ? "Saved. Parents can read it in the app." : "Saved");
    sendPanel(m, staff);
    window.refreshPage();
  });
}

// One WhatsApp button per family (and per staff member), each with the message already written.
async function sendPanel(m, staff) {
  staff = staff || (isAdmin() && (m.userIds || []).length ? await api("GET", "/teachers") : []);
  const fams = families(m.studentIds || []);
  const people = staff.filter((u) => (m.userIds || []).includes(u.id));
  const textFor = (who) => fill(m.body, who) + signOff(m);
  const groupText = fill(m.body, { parent: "", child: "your child" }) + signOff(m);
  const classes = state.classes.filter((c) => fams.some((f) => f.kids.some((k) => k.classId === c.id)));
  const rows = [
    ...fams.map((f) => ({ name: f.parent, sub: f.kids.map(studentName).join(", "), phone: f.phone, text: textFor({ parent: f.parent.split(" ")[0], child: childNames(f.kids), cls: className(f.kids[0].classId) }) })),
    ...people.map((u) => ({ name: u.name, sub: "Staff", phone: u.phone, text: textFor({ parent: u.name.split(" ")[0], child: "" }) })),
  ];
  const { el } = modal({
    title: "Send on WhatsApp",
    wide: true,
    body: `<p class="muted small">WhatsApp only lets you send to one chat at a time. Tap <strong>Send</strong> for each person, or post it once in the class group.</p>
      ${classes.length && classes.length <= 3 ? `<div class="btn-row" style="margin-bottom:12px">${classes.map((c) => `<a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waShare(groupText))}">Post in ${esc(c.name)} group</a>`).join("")}
        <button class="btn secondary sm" id="copy">Copy message</button></div>` : `<div class="btn-row" style="margin-bottom:12px"><button class="btn secondary sm" id="copy">Copy message</button></div>`}
      <div class="table-wrap" style="max-height:50vh;overflow:auto"><table><tbody>
      ${rows.map((r, i) => `<tr><td><strong>${esc(r.name)}</strong><div class="small muted">${esc(r.sub)}</div></td><td class="small">${esc(r.phone || "")}</td>
        <td style="text-align:right">${r.phone ? `<a class="btn wa sm" data-i="${i}" target="_blank" rel="noopener" href="${esc(waChat(r.phone, r.text))}">Send</a>` : `<span class="muted small">No phone${m.inApp !== false ? ": will see it in the app" : ""}</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="modal-foot"><button class="btn" data-close>Done</button></div>`,
  });
  el.querySelectorAll("[data-i]").forEach((a) => a.addEventListener("click", () => setTimeout(() => { a.textContent = "✓ Opened"; a.classList.replace("wa", "secondary"); }, 50)));
  el.querySelector("#copy").onclick = async () => {
    try { await navigator.clipboard.writeText(groupText); toast("Message copied"); } catch { toast("Couldn't copy. Select the text in the message box instead.", "error"); }
  };
}

function loginPanel({ logins, noPhone }) {
  const kidsOf = (l) => state.students.filter((s) => l.studentIds.includes(s.id));
  const textFor = (l) => `As-salamu alaykum ${l.name.split(" ")[0]}! ${appInviteLine()}\n\nUsername: ${l.username}\n${l.tempPassword ? `Password: ${l.tempPassword}\n\nPlease change your password after signing in.` : "Password: the one you already use (ask the office if you forgot it)."}\n\n— ${state.settings.schoolName}`;
  modal({
    title: "Send login details",
    wide: true,
    body: `${logins.some((l) => l.tempPassword) ? `<p class="error-text">Send these now. New passwords can't be shown again (you can make another one later).</p>` : ""}
      ${noPhone.length ? `<p class="muted small">No parent phone on file, so no login for: ${esc(noPhone.join(", "))}.</p>` : ""}
      <div class="table-wrap" style="max-height:55vh;overflow:auto"><table><thead><tr><th>Family</th><th>Username</th><th>Password</th><th></th></tr></thead><tbody>
      ${logins.map((l) => `<tr><td><strong>${esc(l.name)}</strong>${l.isNew ? ` <span class="badge green">new</span>` : ""}<div class="small muted">${esc(kidsOf(l).map(studentName).join(", "))}</div></td>
        <td>${esc(l.username)}</td><td>${l.tempPassword ? `<code>${esc(l.tempPassword)}</code>` : `<span class="muted small">unchanged</span>`}</td>
        <td style="text-align:right"><a class="btn wa sm" target="_blank" rel="noopener" href="${esc(waChat(l.username, textFor(l)))}">Send</a></td></tr>`).join("") || `<tr><td>${emptyState("No families with a phone number were chosen.")}</td></tr>`}
      </tbody></table></div>
      <div class="modal-foot"><button class="btn" data-close>Done</button></div>`,
  });
}
