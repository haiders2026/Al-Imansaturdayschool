import { state, api, esc, fmtDate, lastSaturday, studentName, classOptions, defaultClassId, rememberClass, toast, emptyState, waChat, parentPhone, parentName, STATUS_LABEL } from "../core.js";

export async function render(page, [classIdParam, dateParam]) {
  if (!state.classes.length) { page.innerHTML = `<h1>Attendance</h1><div class="card">${emptyState("No classes available yet.")}</div>`; return; }
  const classId = classIdParam || defaultClassId();
  const date = dateParam || lastSaturday();
  rememberClass(classId);
  const students = state.students.filter((s) => s.classId === classId && s.active !== false).sort((a, b) => studentName(a).localeCompare(studentName(b)));
  const [saved, staff] = await Promise.all([api("GET", `/attendance?classId=${classId}&date=${date}`), api("GET", "/teachers")]);
  const cls = state.classes.find((c) => c.id === classId) || {};
  const names = (ids) => (ids || []).map((id) => staff.find((t) => t.id === id)?.name).filter(Boolean).join(", ");
  const staffLine = [names(cls.teacherIds) && `Teacher: ${names(cls.teacherIds)}`, names(cls.assistantIds) && `Assistant: ${names(cls.assistantIds)}`].filter(Boolean).join(" · ");
  const isNew = !Object.keys(saved.records).length;
  const records = { ...saved.records };

  page.innerHTML = `
    <div class="page-head"><div><h1>Attendance · ${esc(cls.name || "")}</h1>${staffLine ? `<div class="small">${esc(staffLine)}</div>` : ""}<div class="muted" id="status">${isNew ? "Not taken yet for this day" : `Last saved by ${esc(saved.takenBy)} · you can still make changes`}</div></div></div>
    <div class="card">
      <div class="toolbar">
        <div class="field"${state.classes.length === 1 ? ' style="display:none"' : ""}><label>Class</label><select id="cls">${classOptions(classId)}</select></div>
        <div class="field"><label>Date</label><input type="date" id="date" value="${date}"></div>
        <button class="btn secondary" id="all-present">Mark all present</button>
        <div id="counts" class="muted" style="margin-left:auto"></div>
      </div>
      ${students.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Student</th><th>Status</th><th class="no-print">Parent</th></tr></thead><tbody>
        ${students.map((s, i) => `<tr><td>${i + 1}</td><td><a href="#/student/${s.id}">${esc(studentName(s))}</a></td>
          <td><div class="att" data-id="${s.id}">${["P", "A", "L", "E"].map((st) => `<button type="button" data-s="${st}" title="${STATUS_LABEL[st]}">${st}</button>`).join("")}</div></td>
          <td class="no-print">${parentPhone(s) ? `<a href="${waChat(parentPhone(s))}" target="_blank" rel="noopener" title="WhatsApp ${esc(parentName(s))}">💬 ${esc(parentName(s))}</a>` : `<span class="muted small">no phone</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted small">P = Present · A = Absent · L = Late · E = Excused</p>
      <div class="btn-row"><button class="btn" id="save">Save attendance</button></div>` : emptyState("No students in this class.")}
    </div>
    <div id="after"></div>`;

  const paint = () => {
    page.querySelectorAll(".att").forEach((g) => g.querySelectorAll("button").forEach((b) => b.classList.toggle("on", records[g.dataset.id] === b.dataset.s)));
    const c = { P: 0, A: 0, L: 0, E: 0 };
    Object.entries(records).forEach(([id, s]) => { if (students.some((x) => x.id === id)) c[s]++; });
    const unmarked = students.length - c.P - c.A - c.L - c.E;
    page.querySelector("#counts").innerHTML = `<span class="cell P">${c.P}</span> present · <span class="cell A">${c.A}</span> absent · <span class="cell L">${c.L}</span> late · <span class="cell E">${c.E}</span> excused${unmarked ? ` · <strong>${unmarked} not marked</strong>` : ""}`;
  };
  paint();

  page.querySelectorAll(".att button").forEach((b) => b.onclick = () => { records[b.parentElement.dataset.id] = b.dataset.s; paint(); });
  page.querySelector("#all-present").onclick = () => { students.forEach((s) => { if (!records[s.id]) records[s.id] = "P"; }); paint(); };
  const go = () => { location.hash = `#/attendance/${page.querySelector("#cls").value}/${page.querySelector("#date").value}`; };
  page.querySelector("#cls").onchange = go;
  page.querySelector("#date").onchange = go;

  page.querySelector("#save")?.addEventListener("click", async (e) => {
    const unmarked = students.filter((s) => !records[s.id]);
    if (unmarked.length && !confirm(`${unmarked.length} student(s) are not marked. Save anyway?`)) return;
    e.target.disabled = true;
    try {
      await api("PUT", "/attendance", { classId, date, records });
      toast("Attendance saved");
      page.querySelector("#status").textContent = `Saved by ${state.user.name} · you can still make changes`;
      showAbsentees(page.querySelector("#after"), students.filter((s) => ["A", "L"].includes(records[s.id])), records, date);
    } catch (err) { toast(err.message, "error"); }
    finally { e.target.disabled = false; }
  });
  if (!isNew) showAbsentees(page.querySelector("#after"), students.filter((s) => ["A", "L"].includes(records[s.id])), records, date);
}

function showAbsentees(box, list, records, date) {
  if (!list.length) { box.innerHTML = ""; return; }
  box.innerHTML = `<div class="card"><h2>Let parents know</h2><p class="muted">Tap to open WhatsApp with a message ready to send.</p>
    ${list.map((s) => {
      const st = records[s.id] === "A" ? "absent" : "late";
      const msg = `As-salamu alaykum ${parentName(s)}, this is ${state.settings.schoolName}. ${s.firstName} was marked ${st} today (${fmtDate(date)}). Please let us know if everything is okay. JazakAllahu khayran.`;
      return `<div class="list-item btn-row" style="justify-content:space-between"><div><strong>${esc(studentName(s))}</strong> <span class="cell ${records[s.id]}">${records[s.id]}</span></div>
        ${parentPhone(s) ? `<a class="btn sm wa" href="${waChat(parentPhone(s), msg)}" target="_blank" rel="noopener">Message ${esc(parentName(s))}</a>` : `<span class="muted small">No parent phone on file</span>`}</div>`;
    }).join("")}</div>`;
}
