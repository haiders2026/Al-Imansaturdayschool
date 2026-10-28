import { state, api, esc, fmtDate, today, isAdmin, isStaff, className, classOptions, modal, onSubmit, toast, confirmBox, emptyState, waShare } from "../core.js";

export const EVENT_TYPES = { noschool: "No school", event: "Event", exam: "Exam / test", other: "Other" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const onDay = (e, day) => e.date <= day && (e.endDate || e.date) >= day;
export const whenText = (e) => `${fmtDate(e.date)}${e.endDate && e.endDate !== e.date ? ` – ${fmtDate(e.endDate)}` : ""}${e.time ? `, ${e.time}` : ""}`;
export const upcomingEvents = (events) => events.filter((e) => (e.endDate || e.date) >= today());

export function shareText(e) {
  const icon = e.type === "noschool" ? "🚫" : e.type === "exam" ? "📝" : "📅";
  return `${icon} *${e.title}*\n${whenText(e)}${e.classId ? ` · ${className(e.classId)}` : ""}${e.type === "noschool" ? "\nThere is no school on this day." : ""}${e.details ? `\n\n${e.details}` : ""}\n\n— ${state.settings.schoolName}`;
}

export function eventRow(e) {
  const d = new Date(e.date + "T12:00:00");
  return `<div class="list-item btn-row clickable" data-ev="${e.id}" style="flex-wrap:nowrap;align-items:flex-start">
    <div class="ev-date ev ${e.type}" style="width:auto;white-space:normal"><small>${MONTHS[d.getMonth()].slice(0, 3)}</small>${d.getDate()}</div>
    <div style="flex:1"><strong>${esc(e.title)}</strong> <span class="badge ${e.type === "noschool" ? "red" : ""}">${EVENT_TYPES[e.type]}</span>
      <div class="meta">${esc(whenText(e))} · ${e.classId ? esc(className(e.classId)) : "Whole school"}</div></div></div>`;
}

export function wireEvents(root, events) {
  root.querySelectorAll("[data-ev]").forEach((el) => el.onclick = () => viewEvent(events.find((e) => e.id === el.dataset.ev)));
}

export async function render(page, [monthParam = ""]) {
  const events = await api("GET", "/events");
  const [y, m] = /^\d{4}-\d{2}$/.test(monthParam) ? monthParam.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 1];
  const first = new Date(y, m - 1, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  while (days.length > 35 && days[days.length - 7].getMonth() !== m - 1) days.splice(-7);
  const shift = (n) => { const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const upcoming = upcomingEvents(events);

  page.innerHTML = `
    <div class="page-head"><div><h1>School calendar</h1><div class="muted">Holidays, days with no school, events and exams.${isStaff() ? " Tap an event to share it on WhatsApp." : ""}</div></div>
      ${isStaff() ? `<button class="btn" id="new">+ Add to calendar</button>` : ""}</div>
    <div class="grid cols-2" style="grid-template-columns:minmax(0,2fr) minmax(280px,1fr)">
      <div class="card">
        <div class="cal-head"><a class="btn secondary sm" href="#/calendar/${shift(-1)}">‹</a><h2 style="margin:0">${MONTHS[m - 1]} ${y}</h2><a class="btn secondary sm" href="#/calendar/${shift(1)}">›</a></div>
        <div class="cal">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => `<div class="dow">${d}</div>`).join("")}
          ${days.map((d) => {
            const day = ymd(d);
            return `<div class="day ${d.getMonth() !== m - 1 ? "other" : ""} ${d.getDay() === 6 ? "sat" : ""} ${day === today() ? "today" : ""}"><span class="num">${d.getDate()}</span>
              ${events.filter((e) => onDay(e, day)).map((e) => `<button class="ev ${e.type}" data-ev="${e.id}" title="${esc(e.title)}">${esc(e.title)}</button>`).join("")}</div>`;
          }).join("")}</div>
        <p class="small muted" style="margin:10px 0 0">${Object.entries(EVENT_TYPES).map(([k, l]) => `<span class="ev ${k}" style="display:inline-block;width:auto;margin-right:6px">${l}</span>`).join("")}</p>
      </div>
      <div class="card"><h2>Coming up</h2>${upcoming.length ? upcoming.slice(0, 12).map(eventRow).join("") : emptyState("Nothing on the calendar yet.")}</div>
    </div>`;

  wireEvents(page, events);
  page.querySelector("#new")?.addEventListener("click", () => eventForm({ date: today() }));
}

export function viewEvent(e) {
  const canEdit = isAdmin() || e.authorId === state.user.id;
  const { el, close } = modal({
    title: e.title,
    body: `<div class="btn-row" style="margin-bottom:10px"><span class="badge ${e.type === "noschool" ? "red" : ""}">${EVENT_TYPES[e.type]}</span><span class="badge">${e.classId ? esc(className(e.classId)) : "Whole school"}</span></div>
      <p><strong>${esc(whenText(e))}</strong></p>
      ${e.details ? `<div class="note-text">${esc(e.details)}</div>` : ""}
      <div class="modal-foot">
        ${canEdit ? `<button class="btn danger" id="del" style="margin-right:auto">Delete</button><button class="btn secondary" id="edit">Edit</button>` : ""}
        <a class="btn wa" target="_blank" rel="noopener" href="${esc(waShare(shareText(e)))}">Share on WhatsApp</a>
        <button class="btn secondary" data-close>Close</button></div>`,
  });
  el.querySelector("#edit")?.addEventListener("click", () => { close(); eventForm(e); });
  el.querySelector("#del")?.addEventListener("click", async () => {
    if (!(await confirmBox(`Delete “${e.title}” from the calendar?`))) return;
    await api("DELETE", `/events/${e.id}`);
    close();
    toast("Removed from the calendar");
    window.refreshPage();
  });
}

function eventForm(e = {}) {
  const { el, close } = modal({
    title: e.id ? "Edit calendar entry" : "Add to calendar",
    body: `<form>
      <div class="field"><label>Title</label><input name="title" value="${esc(e.title || "")}" required placeholder="e.g. Eid al-Adha holiday, Quran competition"></div>
      <div class="form-grid">
        <div class="field"><label>Type</label><select name="type">${Object.entries(EVENT_TYPES).map(([k, l]) => `<option value="${k}" ${k === (e.type || "event") ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label>Date</label><input type="date" name="date" value="${esc(e.date || "")}" required></div>
        <div class="field"><label>End date (if more than one day)</label><input type="date" name="endDate" value="${esc(e.endDate || "")}"></div>
        <div class="field"><label>Time (optional)</label><input name="time" value="${esc(e.time || "")}" placeholder="10am – 1pm"></div>
      </div>
      <div class="field"><label>Who is it for?</label><select name="classId">${classOptions(e.classId || "", { includeAll: isAdmin(), allLabel: "Whole school" })}</select></div>
      <div class="field"><label>Details</label><textarea name="details">${esc(e.details || "")}</textarea></div>
      ${e.id ? "" : `<label class="check"><input type="checkbox" name="share" checked> Share on WhatsApp after saving</label>`}
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    const saved = await api("POST", "/events", { ...v, id: e.id });
    toast("Saved to the calendar");
    close();
    if (v.share) window.open(waShare(shareText(saved)), "_blank");
    window.refreshPage();
  });
}
