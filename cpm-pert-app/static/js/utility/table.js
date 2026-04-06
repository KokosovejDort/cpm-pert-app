// ── Table Management ──────────────────────────────────────────────────────────
// Column layout: [0:ID][1:Name][2:Dur][3:Dep][4:Opt][5:ML][6:Pess][7:Del]

function readTable() {
  const pert = isPertMode();
  return Array.from(document.querySelectorAll("#input-table tbody tr"))
    .map((row) => {
      const cells = row.querySelectorAll("td");
      const id = cells[0].textContent.trim();
      if (!id) return null;

      const base = {
        id,
        name: cells[1].textContent.trim(),
        dependencies: parseDependencies(cells[3].textContent.trim()),
      };

      if (pert) {
        base.optimistic = Number(cells[4].textContent.trim() || "0");
        base.most_likely = Number(cells[5].textContent.trim() || "0");
        base.pessimistic = Number(cells[6].textContent.trim() || "0");
      } else {
        base.duration = Number(cells[2].textContent.trim() || "0");
      }
      return base;
    })
    .filter(Boolean);
}

function applyTasksToTable(tasks) {
  const tbody = document.querySelector("#input-table tbody");
  tbody.innerHTML = "";
  tasks.forEach((task) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
                <td contenteditable="true"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true" class="col-duration-cell"></td>
                <td contenteditable="true"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td contenteditable="true" class="col-pert-cell"></td>
                <td><button class="btn-del btn btn-sm btn-outline-danger">Delete</button></td>
            `;
    const cells = tr.querySelectorAll("td");
    cells[0].textContent = task.id;
    cells[1].textContent = task.name || task.id;
    cells[2].textContent = String(task.duration ?? "0");
    cells[3].textContent = task.dependencies || "";
    cells[4].textContent = String(task.optimistic ?? "");
    cells[5].textContent = String(task.most_likely ?? "");
    cells[6].textContent = String(task.pessimistic ?? "");
    applyPertModeToRow(tr);
    tbody.appendChild(tr);
  });
}

function parseDependencies(dependenciesText) {
  if (!dependenciesText) return [];
  return dependenciesText
    .split(/[,;]/)
    .map((dep) => dep.trim())
    .filter(Boolean);
}

function getNextId() {
  const rows = document.querySelectorAll("#input-table tbody tr");
  if (rows.length === 0) return "A";

  const lastRow = rows[rows.length - 1];
  const lastId = lastRow.querySelectorAll("td")[0].textContent.trim();
  if (lastId.match(/^[A-Y]$/))
    return String.fromCharCode(lastId.charCodeAt(0) + 1);
  if (lastId === "Z") return "A1";
  if (lastId.match(/^[A-Z]\d+$/)) {
    const letter = lastId[0];
    const number = parseInt(lastId.slice(1));

    if (letter !== "Z")
      return String.fromCharCode(letter.charCodeAt(0) + 1) + number;
    else return "A" + (number + 1);
  }
  return "A";
}

// ── CSV Import ────────────────────────────────────────────────────────────────

function parseCpmCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2)
    throw new Error("CSV must contain a header and at least one data row.");

  const headerCols = lines[0].toLowerCase().split(",").map((c) => c.trim());
  const isPert = headerCols.some((c) => c === "opt" || c === "ml" || c === "pess");

  return lines.slice(1).map((line, idx) => {
    const rowNumber = idx + 2;
    const cols = line.split(",").map((c) => c.trim());

    if (isPert) {
      if (cols.length < 5)
        throw new Error(`Row ${rowNumber}: PERT CSV needs at least 5 columns.`);
      const [idRaw, prRaw, oRaw, mRaw, pRaw, nameRaw] = cols;
      if (!idRaw) throw new Error(`Row ${rowNumber}: missing ID.`);
      return {
        id: idRaw,
        name: nameRaw || idRaw,
        optimistic: String(Number(oRaw)),
        most_likely: String(Number(mRaw)),
        pessimistic: String(Number(pRaw)),
        dependencies: parseCsvPredecessors(prRaw).join(", "),
      };
    } else {
      if (cols.length < 3)
        throw new Error(`Row ${rowNumber}: expected at least 3 columns.`);
      const [idRaw, prRaw, duRaw, nameRaw] = cols;
      if (!idRaw) throw new Error(`Row ${rowNumber}: missing ID.`);
      const duration = Number(duRaw);
      if (!isFinite(duration))
        throw new Error(`Row ${rowNumber}: invalid duration.`);
      return {
        id: idRaw,
        name: nameRaw || idRaw,
        duration: String(duration),
        dependencies: parseCsvPredecessors(prRaw).join(", "),
      };
    }
  });
}

function parseCsvPredecessors(prCell) {
  const trimmed = (prCell || "").trim();
  if (!trimmed || trimmed === "-") return [];
  if (/[,\s;]+/.test(trimmed)) {
    return trimmed
      .split(/[,\s;]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  if (/^[A-Za-z]+$/.test(trimmed)) return trimmed.split("");
  return [trimmed];
}

function parseJsonTasks(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) {
    throw new Error("Invalid JSON: " + e.message);
  }
  if (!Array.isArray(data)) throw new Error("JSON must be an array of task objects.");
  if (data.length === 0) throw new Error("JSON array is empty.");
  return data.map((obj, idx) => {
    const rowNum = idx + 1;
    if (!obj.id) throw new Error(`Row ${rowNum}: missing "id" field.`);
    const deps = Array.isArray(obj.dependencies)
      ? obj.dependencies.join(", ")
      : String(obj.dependencies || "");
    const task = { id: String(obj.id), name: String(obj.name || obj.id), dependencies: deps };
    if (obj.optimistic !== undefined || obj.most_likely !== undefined || obj.pessimistic !== undefined) {
      task.optimistic = String(obj.optimistic ?? "");
      task.most_likely = String(obj.most_likely ?? "");
      task.pessimistic = String(obj.pessimistic ?? "");
    } else {
      task.duration = String(obj.duration ?? "0");
    }
    return task;
  });
}

function parseXlsxToTasks(arrayBuffer) {
  if (typeof XLSX === "undefined") throw new Error("SheetJS library is not loaded.");
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) throw new Error("Excel file contains no sheets.");
  return parseCpmCsv(XLSX.utils.sheet_to_csv(wb.Sheets[wsName]));
}

function handleFileUpload(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  input.value = "";
  const tbody = document.querySelector("#input-table tbody");
  if (tbody) tbody.innerHTML = "";
  const ext = file.name.split(".").pop().toLowerCase();
  const out = document.getElementById("out");

  function onError(format, err) {
    console.error(err);
    const hint = " — Check header names and correct format (ⓘ Import).";
    show(out, "error", `Failed to import ${format}: ${err.message}${hint}`);
  }

  if (ext === "json") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { applyTasksToTable(parseJsonTasks(e.target.result)); }
      catch (err) { onError("JSON", err); }
    };
    reader.readAsText(file);
  } else if (ext === "xlsx" || ext === "xls") {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { applyTasksToTable(parseXlsxToTasks(e.target.result)); }
      catch (err) { onError("Excel file", err); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { applyTasksToTable(parseCpmCsv(e.target.result)); }
      catch (err) { onError("CSV", err); }
    };
    reader.readAsText(file);
  }
}

// ── PERT Mode ─────────────────────────────────────────────────────────────────

function isPertMode() {
  const toggle = document.getElementById("toggle-pert");
  return toggle ? toggle.checked : false;
}

function switchPertMode(enabled) {
  document
    .querySelectorAll(".col-duration")
    .forEach((el) => el.classList.toggle("d-none", enabled));
  document
    .querySelectorAll(".col-pert")
    .forEach((el) => el.classList.toggle("d-none", !enabled));

  document.querySelectorAll("#input-table tbody tr").forEach((row) => {
    const cells = row.querySelectorAll("td");
    if (cells.length < 7) return;

    if (enabled) {
      // CPM → PERT: seed O/M/P from duration when they are blank
      const dur = cells[2].textContent.trim();
      if (dur && dur !== "0") {
        if (!cells[4].textContent.trim()) cells[4].textContent = dur;
        if (!cells[5].textContent.trim()) cells[5].textContent = dur;
        if (!cells[6].textContent.trim()) cells[6].textContent = dur;
      }
    } else {
      // PERT → CPM: compute expected duration (O + 4M + P) / 6
      const o = parseFloat(cells[4].textContent.trim()) || 0;
      const m = parseFloat(cells[5].textContent.trim()) || 0;
      const p = parseFloat(cells[6].textContent.trim()) || 0;
      const expected = (o + 4 * m + p) / 6;
      if (
        expected > 0 &&
        (!cells[2].textContent.trim() || cells[2].textContent.trim() === "0")
      ) {
        cells[2].textContent = formatNumber(expected);
      }
    }

    applyPertModeToRow(row);
  });
}

function applyPertModeToRow(tr) {
  const pert = isPertMode();
  const cells = tr.querySelectorAll("td");
  if (cells.length < 7) return;
  cells[2].classList.toggle("d-none", pert);
  cells[4].classList.toggle("d-none", !pert);
  cells[5].classList.toggle("d-none", !pert);
  cells[6].classList.toggle("d-none", !pert);
}
