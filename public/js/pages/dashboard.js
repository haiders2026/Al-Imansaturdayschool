import { state, api, esc, fmtDate, fmtMoney, isAdmin, isParent, isStaff, can, studentName, className, classOptions, modal, onSubmit, toast, confirmBox, emptyState, waShare } from "../core.js";
import { upcomingEvents, eventRow, wireEvents, whenText } from "./calendar.js";
import { inboxItem } from "./messages.js";

export async function render(page) {
  const [dash, announcements, events] = await Promise.all([api("GET", "/dashboard"), api("GET", "/announcements"), api("GET", "/events")]);
  const upcoming = upcomingEvents(events);
  // Warn about a day off in the next two weeks, so nobody turns up to a closed school.
  const soon = new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10);
  const closed = upcoming.find((e) => e.type === "noschool" && e.date <= soon);
  const firstName = state.user.name.replace(/^(br|sr|sis|bro|dr|mr|mrs|ms|sheikh|shaykh|maulana|syed|sayed)\.?\s+/i, "").split(" ")[0];
  const hello = `As-salamu alaykum, ${esc(firstName)}`;

  let top = "";
  if (isAdmin()) {
    const f = dash.finance;
    top = `<div class="stats">
      ${stat("Students", dash.studentCount, `${dash.classCount} grades/classes`)}
      ${stat("Teachers", dash.teacherCount, "")}
      ${dash.lastDay ? stat("Last attendance", `${dash.lastDay.present} present`, `${dash.lastDay.absent} absent · ${fmtDate(dash.lastDay.date)}`) : stat("Last attendance", "None yet", "")}
      ${f ? stat("Fees collected", fmtMoney(f.paid), `of ${fmtMoney(f.fee)} expected`) : ""}
      ${f ? stat("Outstanding", fmtMoney(f.balance), `${f.unpaidCount} students owe`) : ""}
      ${dash.registrationsWaiting ? `<a href="#/registrations" style="text-decoration:none;color:inherit">${stat("Registrations", `${dash.registrationsWaiting} new`, "to review")}</a>` : ""}
      ${dash.plansWaiting ? `<a href="#/lessonplans" style="text-decoration:none;color:inherit">${stat("Lesson plans", `${dash.plansWaiting} to review`, "from teachers")}</a>` : ""}
    </div>
    ${can("settings") ? setupWarnings(dash) : ""}`;
  } else if (isParent()) {
    const kids = state.students;
    const [profiles, messages] = await Promise.all([Promise.all(kids.map((k) => api("GET", `/students/${k.id}/profile`))), api("GET", "/messages")]);
    top = `${messages.length ? `<div class="card"><h2>Messages from the school</h2>${messages.slice(0, 3).map(inboxItem).join("")}${messages.length > 3 ? `<p><a href="#/messages">All messages →</a></p>` : ""}</div>` : ""}<div class="grid cols-2">${profiles.map(childCard).join("") || `<div class="card">${emptyState("No children are linked to your login yet. Please contact the school office.")}</div>`}</div>`;
  } else {
    top = `<div class="stats">${stat("My students", dash.studentCount, `${dash.classCount} class(es)`)}
      ${dash.lastDay ? stat("Last attendance", `${dash.lastDay.present} present`, `${dash.lastDay.absent} absent · ${fmtDate(dash.lastDay.date)}`) : stat("Last attendance", "None yet", "")}</div>
      <div class="grid cols-3">${dash.classes.map(teacherClassCard).join("") || `<div class="card">${emptyState("You haven't been assigned a class yet. Ask the admin to assign you.")}</div>`}</div>`;
  }

  page.innerHTML = `
    <div class="page-head"><div><h1>${hello}</h1><div class="muted">${fmtDate(new Date().toISOString())}</div></div>
      ${isStaff() ? `<button class="btn" id="new-ann">+ Announcement</button>` : ""}</div>
    ${closed ? `<div class="banner red">🚫 No school: ${esc(closed.title)} · ${esc(whenText(closed))}${closed.classId ? ` (${esc(className(closed.classId))})` : ""}</div>` : ""}
    ${top}
    <div class="grid cols-2">
      <div class="card"><h2>Announcements</h2>${announcements.length ? announcements.slice(0, 8).map(annItem).join("") : emptyState("No announcements yet.")}</div>
      <div class="card"><h2>Upcoming assignments</h2>${dash.upcoming.length ? dash.upcoming.map((a) => `
        <div class="list-item"><strong>${esc(a.title)}</strong> <span class="badge">${esc(className(a.classId))}</span>
        <div class="meta">Due ${fmtDate(a.dueDate)}</div></div>`).join("") + `<p><a href="#/assignments">All assignments →</a></p>` : emptyState("Nothing due.")}</div>
      <div class="card"><h2>Coming up</h2>${upcoming.length ? upcoming.slice(0, 5).map(eventRow).join("") : emptyState("Nothing on the calendar yet.")}<p><a href="#/calendar">School calendar →</a></p></div>
    </div>`;
  wireEvents(page, events);

  page.querySelector("#new-ann")?.addEventListener("click", newAnnouncement);
  page.querySelectorAll("[data-del-ann]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("Delete this announcement?"))) return;
    await api("DELETE", `/announcements/${b.dataset.delAnn}`);
    window.refreshPage();
  });
}

const stat = (label, value, sub) => `<div class="stat"><div class="label">${label}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;

function setupWarnings(dash) {
  const items = [];
  if (!dash.classCount) items.push(`No grades/classes yet. <a href="#/settings/import">Import your student sheet</a> to create them.`);
  if (dash.noTeacher?.length) items.push(`No teacher assigned: ${esc(dash.noTeacher.join(", "))}. <a href="#/classes">Assign teachers</a>`);
  if (dash.noWhatsapp?.length) items.push(`No WhatsApp group link: ${esc(dash.noWhatsapp.join(", "))}. <a href="#/classes">Add links</a>`);
  if (!dash.teacherCount) items.push(`No teacher logins yet. <a href="#/users">Add teachers</a>`);
  return items.length ? `<div class="card" style="border-color:#f0d9a6;background:#fffaf0"><h3>To finish setting up</h3><ul style="margin:0;padding-left:18px">${items.map((i) => `<li>${i}</li>`).join("")}</ul></div>` : "";
}

function annItem(a) {
  const canDelete = isAdmin() || a.authorId === state.user.id;
  return `<div class="list-item"><div class="btn-row" style="justify-content:space-between"><strong>${esc(a.title)}</strong>
    <span class="btn-row">${isStaff() ? `<a class="btn link small" target="_blank" rel="noopener" href="${esc(waShare(`📢 *${a.title}*\n${a.body || ""}\n\n— ${state.settings.schoolName}`))}">Share on WhatsApp</a>` : ""}
    ${canDelete ? `<button class="btn link small" data-del-ann="${a.id}">Delete</button>` : ""}</span></div>
    ${a.body ? `<div class="note-text">${esc(a.body)}</div>` : ""}
    <div class="meta">${esc(a.authorName)} · ${fmtDate(a.createdAt)} · ${a.classId ? esc(className(a.classId)) : "Whole school"}</div></div>`;
}

function teacherClassCard(c) {
  return `<div class="card"><h2>${esc(c.name)}</h2><p class="muted">${c.studentCount} students${c.room ? ` · Room ${esc(c.room)}` : ""}</p>
    <div class="btn-row">
      ${can("attendance") ? `<a class="btn sm" href="#/attendance/${c.id}">Take attendance</a>` : ""}
      ${can("grades") ? `<a class="btn sm secondary" href="#/grades/${c.id}">Grades</a>` : ""}
      ${can("assignments") ? `<a class="btn sm secondary" href="#/assignments/${c.id}">Assignments</a>` : ""}
      ${c.whatsappLink ? `<a class="btn sm wa" href="${esc(c.whatsappLink)}" target="_blank" rel="noopener">WhatsApp group</a>` : ""}
    </div></div>`;
}

function childCard(p) {
  const s = p.student;
  const rate = p.attendance.rate;
  return `<div class="card"><div class="btn-row" style="justify-content:space-between"><h2 style="margin:0">${esc(studentName(s))}</h2><span class="badge green">${esc(p.class?.name || "")}</span></div>
    <div class="stats" style="margin-top:12px">
      <div class="stat"><div class="label">Attendance</div><div class="value">${rate === null ? "–" : rate + "%"}</div><div class="sub">${p.attendance.counts.A} absences</div></div>
      <div class="stat"><div class="label">Average</div><div class="value">${p.average === null ? "–" : p.average + "%"}</div><div class="sub">${p.grades.length} tests</div></div>
      ${p.finance?.fee ? `<div class="stat"><div class="label">Balance</div><div class="value">${fmtMoney(Math.max(p.finance.balance, 0))}</div><div class="sub">${p.finance.balance <= 0 ? "Paid in full" : "remaining"}</div></div>` : ""}
    </div>
    <div class="btn-row"><a class="btn sm" href="#/student/${s.id}">Full details</a>
      ${p.class?.whatsappLink ? `<a class="btn sm wa" href="${esc(p.class.whatsappLink)}" target="_blank" rel="noopener">Join class WhatsApp</a>` : ""}</div></div>`;
}

function newAnnouncement() {
  const { el, close } = modal({
    title: "New announcement",
    body: `<form>
      <div class="field"><label>Title</label><input name="title" required></div>
      <div class="field"><label>Message</label><textarea name="body"></textarea></div>
      <div class="field"><label>Who is it for?</label><select name="classId">${classOptions("", { includeAll: isAdmin(), allLabel: "Whole school" })}</select></div>
      <label class="check"><input type="checkbox" name="share" checked> Also share on WhatsApp after posting</label>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Post</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    await api("POST", "/announcements", v);
    toast("Announcement posted");
    close();
    if (v.share) window.open(waShare(`📢 *${v.title}*\n${v.body}\n\n— ${state.settings.schoolName}`), "_blank");
    window.refreshPage();
  });
}
