import { state, api, esc, fmtDate, studentName, className, classOptions, defaultClassId, rememberClass, emptyState, download, toCSV, parentPhone, parentName } from "../core.js";

export async function render(page, [view = "attendance", classIdParam]) {
  const classId = classIdParam || defaultClassId();
  rememberClass(classId);
  const sel = view === "attendance" ? classId : classIdParam || "";
  const views = [["attendance", "Attendance register"], ["roster", "Roster & emergency contacts"], ["birthdays", "Birthdays"]];
  page.innerHTML = `
    <div class="page-head"><div><h1>Reports</h1></div><div class="btn-row no-print"><button class="btn secondary" id="csv">Export CSV</button><button class="btn secondary" onclick="print()">Print</button></div></div>
    <div class="tabs">${views.map(([k, l]) => `<button data-v="${k}" class="${k === view ? "active" : ""}">${l}</button>`).join("")}</div>
    <div class="card"><div class="toolbar no-print"><div class="field"><label>Class</label><select id="cls">${classOptions(sel, { includeAll: view !== "attendance" })}</select></div></div>
    <div class="print-only"><h2>${esc(state.settings.schoolName)} — ${esc(views.find((v) => v[0] === view)[1])}${view === "attendance" ? ` — ${esc(className(classId))}` : ""}</h2></div>
    <div id="out"></div></div>`;
  page.querySelectorAll("[data-v]").forEach((b) => b.onclick = () => { location.hash = `#/reports/${b.dataset.v}/${page.querySelector("#cls").value}`; });
  page.querySelector("#cls").onchange = (e) => { location.hash = `#/reports/${view}/${e.target.value}`; };
  const out = page.querySelector("#out");
  const csv = page.querySelector("#csv");
  if (!state.classes.length) { out.innerHTML = emptyState("No classes yet."); return; }
  const students = state.students.filter((s) => s.active !== false && (!sel || s.classId === sel))
    .sort((a, b) => className(a.classId).localeCompare(className(b.classId), undefined, { numeric: true }) || studentName(a).localeCompare(studentName(b)));

  if (view === "attendance") {
    const [{ dates, records }, staff] = await Promise.all([api("GET", `/attendance/report?classId=${classId}`), api("GET", "/teachers")]);
    const byDate = Object.fromEntries(records.map((r) => [r.date, r.records]));
    const takenBy = Object.fromEntries(records.map((r) => [r.date, r.takenBy || ""]));
    const cls = state.classes.find((c) => c.id === classId) || {};
    const names = (ids) => (ids || []).map((id) => staff.find((u) => u.id === id)?.name).filter(Boolean).join(", ");
    const teachers = names(cls.teacherIds) || "Not assigned";
    const assistants = names(cls.assistantIds);
    const header = `<div class="report-head"><div><span class="muted small">Grade</span><strong>${esc(cls.name || "")}</strong></div>
      <div><span class="muted small">Teacher</span><strong>${esc(teachers)}</strong></div>
      ${assistants ? `<div><span class="muted small">Assistant teacher</span><strong>${esc(assistants)}</strong></div>` : ""}
      <div><span class="muted small">Students</span><strong>${students.length}</strong></div></div>`;
    const rate = (s) => {
      const st = dates.map((d) => byDate[d][s.id]).filter(Boolean);
      return st.length ? Math.round((st.filter((x) => x === "P" || x === "L").length / st.length) * 100) : null;
    };
    out.innerHTML = header + (dates.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th>${dates.map((d) => `<th>${fmtDate(d).replace(/,? \d{4}$/, "")}</th>`).join("")}<th class="num">Rate</th></tr></thead><tbody>
      ${students.map((s) => { const r = rate(s); return `<tr><td><a href="#/student/${s.id}/attendance">${esc(studentName(s))}</a></td>${dates.map((d) => { const v = byDate[d][s.id]; return `<td>${v ? `<span class="cell ${v}">${v}</span>` : ""}</td>`; }).join("")}
        <td class="num">${r === null ? "–" : `<span class="badge ${r >= 80 ? "green" : r >= 60 ? "amber" : "red"}">${r}%</span>`}</td></tr>`; }).join("")}
      </tbody><tfoot><tr><td class="small muted">Taken by</td>${dates.map((d) => `<td class="small muted">${esc(takenBy[d])}</td>`).join("")}<td></td></tr></tfoot></table></div><p class="muted small">Below 80% is amber, below 60% is red. Click a student to see details.</p>` : emptyState("No attendance taken for this class yet."));
    csv.onclick = () => download(`attendance-${className(classId)}.csv`, toCSV([
      ["Grade", cls.name || ""], ["Teacher", teachers], ...(assistants ? [["Assistant teacher", assistants]] : []), [],
      ["Student", ...dates, "Rate %"], ...students.map((s) => [studentName(s), ...dates.map((d) => byDate[d][s.id] || ""), rate(s) ?? ""]),
      ["Taken by", ...dates.map((d) => takenBy[d]), ""]]));
  } else if (view === "roster") {
    out.innerHTML = students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Class</th><th>Parent</th><th>Phone</th><th>Emergency</th><th>Allergies / medical</th></tr></thead><tbody>
      ${students.map((s) => `<tr><td>${esc(studentName(s))}</td><td>${esc(className(s.classId))}</td><td>${esc(parentName(s))}</td><td>${esc(parentPhone(s))}</td>
        <td>${esc([s.emergencyContact, s.emergencyPhone].filter(Boolean).join(" · "))}</td><td>${esc([s.allergies, s.medical].filter(Boolean).join(" · "))}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No students.");
    csv.onclick = () => download("roster.csv", toCSV([["Student", "Class", "Parent", "Phone", "Emergency", "Allergies", "Medical"], ...students.map((s) => [studentName(s), className(s.classId), parentName(s), parentPhone(s), [s.emergencyContact, s.emergencyPhone].filter(Boolean).join(" "), s.allergies, s.medical])]));
  } else {
    const withDob = students.filter((s) => s.dob).sort((a, b) => a.dob.slice(5).localeCompare(b.dob.slice(5)));
    const month = new Date().getMonth() + 1;
    const age = (dob) => { const d = new Date(dob), n = new Date(); return n.getFullYear() - d.getFullYear() - (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0); };
    out.innerHTML = withDob.length ? `<div class="table-wrap"><table><thead><tr><th>Birthday</th><th>Student</th><th>Class</th><th class="num">Age</th></tr></thead><tbody>
      ${withDob.map((s) => `<tr style="${Number(s.dob.slice(5, 7)) === month ? "background:var(--amber-soft)" : ""}"><td>${new Date(s.dob + "T12:00").toLocaleDateString(undefined, { day: "numeric", month: "long" })}</td><td>${esc(studentName(s))}</td><td>${esc(className(s.classId))}</td><td class="num">${age(s.dob)}</td></tr>`).join("")}
      </tbody></table></div><p class="muted small">This month's birthdays are highlighted.</p>` : emptyState("No dates of birth on file.");
    csv.onclick = () => download("birthdays.csv", toCSV([["Student", "Class", "Date of birth"], ...withDob.map((s) => [studentName(s), className(s.classId), s.dob])]));
  }
}
