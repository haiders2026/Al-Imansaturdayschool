import { state, api, esc, fmtDate, today, studentName, classOptions, defaultClassId, rememberClass, toast, emptyState, modal, onSubmit, confirmBox, letterGrade, download, toCSV, className } from "../core.js";

const pct = (score, max) => (score === "" || score === undefined || score === null ? null : Math.round((Number(score) / Number(max)) * 100));

export async function render(page, [classIdParam, testId]) {
  if (!state.classes.length) { page.innerHTML = `<h1>Tests & Grades</h1><div class="card">${emptyState("No classes available yet.")}</div>`; return; }
  const classId = classIdParam || defaultClassId();
  rememberClass(classId);
  if (testId) return renderTest(page, classId, testId);

  const { tests, scores } = await api("GET", `/grades/class/${classId}`);
  const students = state.students.filter((s) => s.classId === classId && s.active !== false).sort((a, b) => studentName(a).localeCompare(studentName(b)));
  const avgFor = (sid) => {
    const p = tests.map((t) => pct(scores[t.id]?.[sid]?.score, t.maxScore)).filter((x) => x !== null);
    return p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : null;
  };
  const testAvg = (t) => {
    const p = students.map((s) => pct(scores[t.id]?.[s.id]?.score, t.maxScore)).filter((x) => x !== null);
    return p.length ? Math.round(p.reduce((a, b) => a + b, 0) / p.length) : null;
  };
  const passMark = Number(state.settings.passMark) || 60;

  page.innerHTML = `
    <div class="page-head"><div><h1>Tests & Grades</h1><div class="muted">Create a test, then enter each student's score.</div></div>
      <div class="btn-row"><button class="btn secondary" id="export">Export CSV</button><button class="btn" id="new">+ New test</button></div></div>
    <div class="card">
      <div class="toolbar"><div class="field"><label>Class</label><select id="cls">${classOptions(classId)}</select></div></div>
      ${tests.length ? `<h3>Tests</h3><div class="table-wrap"><table><thead><tr><th>Test</th><th>Subject</th><th>Date</th><th class="num">Out of</th><th class="num">Entered</th><th class="num">Class avg</th><th></th></tr></thead><tbody>
        ${[...tests].reverse().map((t) => { const a = testAvg(t); const n = students.filter((s) => scores[t.id]?.[s.id]?.score !== undefined && scores[t.id]?.[s.id]?.score !== "").length; return `<tr class="clickable" data-test="${t.id}">
          <td><strong>${esc(t.title)}</strong> ${t.type ? `<span class="badge">${esc(t.type)}</span>` : ""}</td><td>${esc(t.subject || "")}</td><td>${fmtDate(t.date)}</td>
          <td class="num">${t.maxScore}</td><td class="num">${n}/${students.length}</td><td class="num">${a === null ? "–" : a + "%"}</td><td><button class="btn sm">Enter scores</button></td></tr>`; }).join("")}
      </tbody></table></div>` : emptyState("No tests yet for this class. Click “New test” to add one.")}
    </div>
    ${tests.length && students.length ? `<div class="card"><h2>Gradebook</h2><div class="table-wrap"><table><thead><tr><th>Student</th>${tests.map((t) => `<th class="num" title="${esc(t.title)}">${esc(t.title.slice(0, 14))}</th>`).join("")}<th class="num">Average</th><th>Grade</th></tr></thead><tbody>
      ${students.map((s) => { const avg = avgFor(s.id); return `<tr><td><a href="#/student/${s.id}">${esc(studentName(s))}</a></td>
        ${tests.map((t) => { const p = pct(scores[t.id]?.[s.id]?.score, t.maxScore); return `<td class="num">${p === null ? `<span class="muted">–</span>` : `<span style="color:${p < passMark ? "var(--red)" : "inherit"}">${p}%</span>`}</td>`; }).join("")}
        <td class="num"><strong>${avg === null ? "–" : avg + "%"}</strong></td><td>${avg === null ? "" : `<span class="badge ${avg >= passMark ? "green" : "red"}">${letterGrade(avg)}</span>`}</td></tr>`; }).join("")}
    </tbody></table></div></div>` : ""}`;

  page.querySelector("#cls").onchange = (e) => { location.hash = `#/grades/${e.target.value}`; };
  page.querySelectorAll("[data-test]").forEach((r) => r.onclick = () => { location.hash = `#/grades/${classId}/${r.dataset.test}`; });
  page.querySelector("#new").onclick = () => testForm(classId);
  page.querySelector("#export").onclick = () => {
    const rows = [["Student", ...tests.map((t) => `${t.title} (/${t.maxScore})`), "Average %", "Grade"]];
    students.forEach((s) => { const avg = avgFor(s.id); rows.push([studentName(s), ...tests.map((t) => scores[t.id]?.[s.id]?.score ?? ""), avg ?? "", avg === null ? "" : letterGrade(avg)]); });
    download(`grades-${className(classId)}.csv`, toCSV(rows));
  };
}

function testForm(classId, test = {}) {
  const { el, close } = modal({
    title: test.id ? "Edit test" : "New test",
    body: `<form><div class="form-grid">
      <div class="field"><label>Test name</label><input name="title" value="${esc(test.title || "")}" placeholder="e.g. Surah Al-Mulk recitation" required></div>
      <div class="field"><label>Subject</label><input name="subject" value="${esc(test.subject || "")}" placeholder="Quran, Arabic, Islamic Studies…" list="subjects"></div>
      <div class="field"><label>Type</label><select name="type">${["Quiz", "Test", "Exam", "Homework", "Recitation", "Project"].map((t) => `<option ${t === test.type ? "selected" : ""}>${t}</option>`).join("")}</select></div>
      <div class="field"><label>Date</label><input type="date" name="date" value="${test.date || today()}"></div>
      <div class="field"><label>Out of (max score)</label><input type="number" name="maxScore" min="1" value="${test.maxScore || 100}" required></div>
      </div><datalist id="subjects"><option>Quran</option><option>Arabic</option><option>Islamic Studies</option><option>Seerah</option><option>Hifz</option><option>Akhlaq</option></datalist>
      <div class="modal-foot"><button type="button" class="btn secondary" data-close>Cancel</button><button class="btn" type="submit">Save</button></div></form>`,
  });
  onSubmit(el.querySelector("form"), async (v) => {
    const saved = await api("POST", "/tests", { ...v, id: test.id, classId });
    close();
    location.hash = `#/grades/${classId}/${saved.id}`;
    if (test.id) window.refreshPage();
  });
}

async function renderTest(page, classId, testId) {
  const { test, scores } = await api("GET", `/tests/${testId}/scores`);
  const students = state.students.filter((s) => s.classId === test.classId && s.active !== false).sort((a, b) => studentName(a).localeCompare(studentName(b)));
  const passMark = Number(state.settings.passMark) || 60;

  page.innerHTML = `
    <p class="no-print"><a href="#/grades/${classId}">← Back to ${esc(className(classId))}</a></p>
    <div class="page-head"><div><h1>${esc(test.title)}</h1><div class="muted">${esc(className(test.classId))} · ${esc(test.subject || "")} · ${fmtDate(test.date)} · out of ${test.maxScore}</div></div>
      <div class="btn-row no-print"><button class="btn secondary" id="edit">Edit test</button><button class="btn danger" id="del">Delete</button><button class="btn secondary" onclick="print()">Print</button></div></div>
    <div class="stats" id="stats"></div>
    <div class="card"><form id="scores">
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Student</th><th style="width:130px">Score / ${test.maxScore}</th><th class="num">%</th><th>Comment</th></tr></thead><tbody>
      ${students.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(studentName(s))}</td>
        <td><input type="number" step="0.5" min="0" max="${test.maxScore}" name="s_${s.id}" value="${scores[s.id]?.score ?? ""}" inputmode="decimal"></td>
        <td class="num" data-pct="${s.id}"></td>
        <td><input name="c_${s.id}" value="${esc(scores[s.id]?.comment || "")}" placeholder="optional"></td></tr>`).join("")}
      </tbody></table></div>
      <div class="btn-row" style="margin-top:12px"><button class="btn" type="submit">Save scores</button><span class="muted small">Tip: press Enter to jump to the next student.</span></div>
    </form></div>`;

  const form = page.querySelector("#scores");
  const update = () => {
    const vals = [];
    students.forEach((s) => {
      const v = form.elements[`s_${s.id}`].value;
      const p = pct(v, test.maxScore);
      const cell = page.querySelector(`[data-pct="${s.id}"]`);
      cell.innerHTML = p === null ? "" : `<span class="badge ${p >= passMark ? "green" : "red"}">${p}% ${letterGrade(p)}</span>`;
      if (p !== null) vals.push(p);
    });
    const avg = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    page.querySelector("#stats").innerHTML = [
      ["Entered", `${vals.length}/${students.length}`], ["Class average", avg === null ? "–" : avg + "%"],
      ["Highest", vals.length ? Math.max(...vals) + "%" : "–"], ["Lowest", vals.length ? Math.min(...vals) + "%" : "–"],
      ["Passed", vals.length ? `${vals.filter((v) => v >= passMark).length}` : "–"],
    ].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
  };
  update();
  form.addEventListener("input", update);
  form.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.name?.startsWith("s_")) {
      e.preventDefault();
      const inputs = [...form.querySelectorAll("input[name^=s_]")];
      inputs[inputs.indexOf(e.target) + 1]?.focus();
    }
  });
  onSubmit(form, async (v) => {
    const out = {};
    students.forEach((s) => { out[s.id] = { score: v[`s_${s.id}`], comment: v[`c_${s.id}`] }; });
    await api("PUT", `/tests/${test.id}/scores`, { scores: out });
    toast("Scores saved");
  });
  page.querySelector("#edit").onclick = () => testForm(classId, test);
  page.querySelector("#del").onclick = async () => {
    if (!(await confirmBox(`Delete “${test.title}” and all its scores?`))) return;
    await api("DELETE", `/tests/${test.id}`);
    toast("Test deleted");
    location.hash = `#/grades/${classId}`;
  };
}
