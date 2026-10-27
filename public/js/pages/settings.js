import { state, api, esc, toast, onSubmit, parseCSV, download, confirmBox, loadCommon, today } from "../core.js";

const FIELDS = [
  ["", "— skip —"], ["firstName", "Student first name"], ["lastName", "Student last name"], ["fullName", "Student full name"],
  ["className", "Grade / class"], ["gender", "Gender"], ["dob", "Date of birth"], ["studentCode", "Student ID"],
  ["fatherName", "Father name"], ["fatherLast", "Father last name"], ["fatherPhone", "Father phone"], ["fatherEmail", "Father email"],
  ["motherName", "Mother name"], ["motherLast", "Mother last name"], ["motherPhone", "Mother phone"], ["motherEmail", "Mother email"],
  ["guardianName", "Guardian name"], ["guardianPhone", "Guardian phone"], ["address", "Address"],
  ["emergencyContact", "Emergency contact"], ["emergencyPhone", "Emergency phone"], ["allergies", "Allergies"], ["medical", "Medical notes"],
  ["fee", "Fee for the year"], ["paid", "Amount already paid"], ["adminNote", "Admin note"],
];

function guess(header) {
  const h = header.toLowerCase();
  const who = h.includes("father") || h.includes("dad") ? "father" : h.includes("mother") || h.includes("mom") ? "mother" : h.includes("guardian") ? "guardian" : h.includes("student") || h.includes("child") ? "student" : "";
  if (h.includes("emerg") || h.includes("emerc")) return h.includes("phone") ? "emergencyPhone" : "emergencyContact";
  if (h.includes("address")) return "address";
  if (h.includes("paid") || h.includes("payment")) return "paid";
  if (/\bfee/.test(h)) return "fee";
  if (h.includes("grade") || h.includes("class")) return "className";
  if (h.includes("gender") || h === "sex") return "gender";
  if (h.includes("dob") || h.includes("birth")) return "dob";
  if (h.includes("allerg")) return "allergies";
  if (h.includes("medical")) return "medical";
  if (h.includes("phone") || h.includes("mobile") || h.includes("cell") || h.includes("whatsapp")) return who === "mother" ? "motherPhone" : who === "guardian" ? "guardianPhone" : "fatherPhone";
  if (h.includes("email")) return who === "mother" ? "motherEmail" : "fatherEmail";
  const first = h.includes("first"), last = h.includes("last");
  if (who === "father") return last && !first ? "fatherLast" : "fatherName";
  if (who === "mother") return last && !first ? "motherLast" : "motherName";
  if (who === "guardian") return "guardianName";
  if (first && last) return "fullName";
  if (first) return "firstName";
  if (last || h.includes("surname")) return "lastName";
  if (h === "name" || h.includes("student")) return "fullName";
  return "";
}

const cellText = (v) => {
  if (v instanceof Date) return new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v ?? "").trim();
};

export async function render(page, [tab = "school"]) {
  const tabs = [["school", "School settings"], ["import", "Import students"], ["backup", "Backup"]];
  page.innerHTML = `<div class="page-head"><h1>Settings & import</h1></div>
    <div class="tabs">${tabs.map(([k, l]) => `<button data-t="${k}" class="${k === tab ? "active" : ""}">${l}</button>`).join("")}</div><div id="body"></div>`;
  page.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => { location.hash = `#/settings/${b.dataset.t}`; });
  const body = page.querySelector("#body");
  if (tab === "import") return importTab(body);
  if (tab === "backup") return backupTab(body);
  schoolTab(body);
}

function schoolTab(body) {
  const s = state.settings;
  body.innerHTML = `<form class="card"><div class="form-grid">
    <div class="field"><label>School name</label><input name="schoolName" value="${esc(s.schoolName)}" required></div>
    <div class="field"><label>Academic year</label><input name="academicYear" value="${esc(s.academicYear)}"></div>
    <div class="field"><label>Currency symbol</label><input name="currency" value="${esc(s.currency)}"></div>
    <div class="field"><label>Default yearly fee per student</label><input type="number" step="0.01" name="defaultFee" value="${esc(s.defaultFee)}"></div>
    <div class="field"><label>Pass mark (%)</label><input type="number" name="passMark" value="${esc(s.passMark)}"></div>
    <div class="field"><label>Country calling code (for WhatsApp)</label><input name="countryCode" value="${esc(s.countryCode)}" placeholder="1 for USA/Canada"></div>
    <div class="field"><label>School contact phone</label><input name="contactPhone" value="${esc(s.contactPhone)}"></div></div>
    <p class="muted small">Fees: each student owes their own fee override if set, otherwise their grade's fee, otherwise this default.</p>
    <button class="btn" type="submit">Save settings</button></form>`;
  onSubmit(body.querySelector("form"), async (v) => {
    state.settings = await api("PUT", "/settings", { ...v, defaultFee: Number(v.defaultFee) || 0, passMark: Number(v.passMark) || 60 });
    toast("Settings saved");
  });
}

function importTab(body) {
  body.innerHTML = `
    <div class="card"><h2>1. Starter file from setup</h2>
      <p class="muted">If you were given an <code>al-iman-starter.json</code> file (students, parents, grades, past attendance and payments from your spreadsheet), load it here once.</p>
      <input type="file" id="seed" accept=".json,application/json"></div>
    <div class="card"><h2>2. Import or update students from a spreadsheet</h2>
      <p class="muted">Upload an Excel (.xlsx) or CSV file with one row per student. Students already in the app (same first and last name) are updated, new ones are added, and grades are created automatically.</p>
      <input type="file" id="sheet" accept=".csv,.xlsx,.xls">
      <div id="map"></div></div>`;

  body.querySelector("#seed").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await confirmBox(`Load ${data.students?.length || 0} students, ${data.classes?.length || 0} grades, ${data.attendance?.length || 0} attendance sheets and ${data.payments?.length || 0} payments?`, { okText: "Load", danger: false }))) return;
      const res = await api("POST", "/seed", data);
      await loadCommon();
      toast(`Loaded ${res.students} students`);
      if (res.teachers?.length) {
        const { modal } = await import("../core.js");
        modal({ title: "Teacher logins created", body: `<p class="error-text">Save these now; they can't be shown again.</p>${res.teachers.map((t) => `<p><strong>${esc(t.name)}</strong> — username <code>${esc(t.username)}</code>, password <code>${esc(t.tempPassword)}</code></p>`).join("")}<div class="modal-foot"><button class="btn" data-close>Done</button></div>` });
      }
    } catch (err) { toast(err.message, "error"); }
  };

  body.querySelector("#sheet").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let rows;
    try {
      if (/\.csv$/i.test(file.name)) rows = parseCSV(await file.text());
      else {
        await loadSheetJS();
        const wb = window.XLSX.read(await file.arrayBuffer(), { cellDates: true });
        const name = wb.SheetNames.find((n) => /student/i.test(n)) || wb.SheetNames[0];
        rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", raw: true });
      }
    } catch (err) { toast("Couldn't read that file: " + err.message, "error"); return; }
    showMapping(body.querySelector("#map"), rows.map((r) => r.map(cellText)));
  };
}

function loadSheetJS() {
  if (window.XLSX) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the Excel reader. Save the sheet as CSV and try again."));
    document.head.appendChild(s);
  });
}

function showMapping(box, rows) {
  // Header row = the row (among the first 5) with the most filled cells. A row above it can label groups (Student / Father / Mother).
  const hi = rows.slice(0, 5).reduce((best, r, i) => (r.filter(Boolean).length > rows[best].filter(Boolean).length ? i : best), 0);
  const group = [];
  if (hi > 0) { let cur = ""; rows[hi - 1].forEach((v, i) => { if (v) cur = v; group[i] = cur; }); }
  const headers = rows[hi].map((h, i) => `${group[i] ? group[i] + " " : ""}${h}`.trim() || `Column ${i + 1}`);
  const data = rows.slice(hi + 1);
  const used = new Set();
  const mapping = headers.map((h) => { const g = guess(h); if (!g || used.has(g)) return ""; used.add(g); return g; });

  box.innerHTML = `<h3 style="margin-top:16px">Match your columns</h3><p class="muted small">${data.length} rows found. Check each column goes to the right place.</p>
    <div class="table-wrap"><table><thead><tr><th>Your column</th><th>Example</th><th>Goes to</th></tr></thead><tbody>
    ${headers.map((h, i) => `<tr><td>${esc(h)}</td><td class="small muted">${esc(data.find((r) => r[i])?.[i] || "")}</td>
      <td><select data-col="${i}">${FIELDS.map(([k, l]) => `<option value="${k}" ${k === mapping[i] ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}
    </tbody></table></div>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="pay"> Record the “amount already paid” column as payments</label>
    <div class="btn-row" style="margin-top:12px"><button class="btn" id="go">Import ${data.length} rows</button></div>`;

  box.querySelector("#go").onclick = async (e) => {
    const cols = [...box.querySelectorAll("[data-col]")].map((s) => s.value);
    const out = data.map((r) => {
      const o = {};
      cols.forEach((k, i) => { if (k && r[i] !== "") o[k] = r[i]; });
      if (o.fullName && !o.firstName) { const parts = o.fullName.split(/\s+/); o.firstName = parts.shift(); o.lastName = o.lastName || parts.join(" "); }
      if (o.fatherLast) o.fatherName = `${o.fatherName || ""} ${o.fatherLast}`.trim();
      if (o.motherLast) o.motherName = `${o.motherName || ""} ${o.motherLast}`.trim();
      if (/^\d+(\.0)?$/.test(o.className || "")) o.className = `Grade ${parseInt(o.className, 10)}`;
      if (o.gender) o.gender = /^m/i.test(o.gender) ? "Male" : /^f/i.test(o.gender) ? "Female" : o.gender;
      ["fullName", "fatherLast", "motherLast"].forEach((k) => delete o[k]);
      Object.keys(o).forEach((k) => { o[k] = String(o[k]).trim(); });
      return o;
    }).filter((o) => o.firstName);
    e.target.disabled = true;
    try {
      const res = await api("POST", "/students/import", { rows: out, importPayments: box.querySelector("#pay").checked });
      await loadCommon();
      box.innerHTML = `<p class="badge green" style="font-size:.95rem;padding:8px 12px">Done: ${res.added} added, ${res.updated} updated, ${res.createdClasses} new grades${res.payments ? `, ${res.payments} payments` : ""}.</p>
        <p><a href="#/students">View students →</a> · <a href="#/classes">Assign teachers and WhatsApp links →</a></p>`;
    } catch (err) { toast(err.message, "error"); e.target.disabled = false; }
  };
}

function backupTab(body) {
  body.innerHTML = `<div class="card"><h2>Download a backup</h2><p class="muted">Saves everything (students, attendance, grades, notes, payments, logins) to one file. Do this every few weeks and keep it somewhere safe. Uploaded assignment files are not included.</p>
      <button class="btn" id="dl">Download backup</button></div>
    <div class="card"><h2>Restore from a backup</h2><p class="muted">This replaces current data with the backup's contents.</p><input type="file" id="restore" accept=".json"></div>`;
  body.querySelector("#dl").onclick = async () => {
    const data = await api("GET", "/backup");
    download(`al-iman-backup-${today()}.json`, JSON.stringify(data, null, 1), "application/json");
  };
  body.querySelector("#restore").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file || !(await confirmBox("Replace all current data with this backup?", { okText: "Restore" }))) return;
    try {
      await api("POST", "/restore", JSON.parse(await file.text()));
      toast("Backup restored");
      setTimeout(() => location.reload(), 800);
    } catch (err) { toast(err.message, "error"); }
  };
}
