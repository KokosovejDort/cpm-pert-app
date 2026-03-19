let cy = null;
let aoaElements = [];
let aonElements = [];

/* ------------------ Cytoscape Network Styles ------------------
   Cytoscape uses its own CSS-like property names (e.g. target-arrow-shape,
   curve-style) that are not valid browser CSS, so these live here as a JS
   constant rather than in network.css.
*/
const CY_STYLE = [
  {
    selector: "node",
    style: {
      shape: "ellipse",
      width: 90,
      height: 90,
      "background-color": "#ffffff",
      "background-image": "data(bgImage)",
      "background-fit": "contain",
      "background-clip": "none",
      "border-width": 0,
      label: "",
    },
  },
  {
    selector: "node.crit, node.noncrit",
    style: {
      shape: "rectangle",
      width: 130,
      height: 90,
      "background-color": "#ffffff",
      "background-image": "data(bgImage)",
      "background-fit": "contain",
      "background-clip": "none",
      "border-width": 0,
      label: "",
    },
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": "#6b7280",
      "target-arrow-color": "#6b7280",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": 13,
      "font-weight": "700",
      "font-family": "monospace",
      color: "#2c1810",
      "text-background-color": "#f5f0e8",
      "text-background-opacity": 0.85,
      "text-background-padding": "3px",
      "text-margin-y": -12,
      "source-distance-from-node": 6,
      "target-distance-from-node": 6,
    },
  },
  {
    selector: "edge.crit",
    style: {
      "line-color": "#b83232",
      "target-arrow-color": "#b83232",
      color: "#b83232",
      width: 3,
      "text-background-color": "#fff5f5",
    },
  },
  {
    selector: "edge.noncrit",
    style: { "line-color": "#6b7280", "target-arrow-color": "#6b7280" },
  },
  {
    selector: "edge.dummy",
    style: {
      "line-style": "dashed",
      "line-dash-pattern": [7, 4],
      width: 2,
      color: "#888",
      "text-background-color": "#f8f8f8",
    },
  },
  {
    selector: "edge.dummy.crit",
    style: {
      "line-color": "#b83232",
      "target-arrow-color": "#b83232",
      color: "#b83232",
    },
  },
];

//Helper functions
function fmt(x) {
  return Number(x).toFixed(2).replace(/\.00$/, "");
}

function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

//State management (Local Storage)
function saveState() {
  try {
    const tasks = readTable();
    localStorage.setItem("cpm_scheduler_data", JSON.stringify(tasks));
  } catch (e) {
    console.error("Save failed:", e);
  }
}

function loadState() {
  const raw = localStorage.getItem("cpm_scheduler_data");
  if (raw) {
    try {
      const tasks = JSON.parse(raw);
      if (Array.isArray(tasks)) applyTasksToTable(tasks);
    } catch (e) {
      console.error("Load failed", e);
    }
  }
}

//Validation logic
async function validateWithServer() {
  const tasks = readTable();

  document.querySelectorAll("#input-table tbody tr").forEach((row) => {
    row.classList.remove("table-danger");
    row.title = "";
  });

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: tasks,
        mode: isPertMode() ? "pert" : "cpm",
      }),
    });

    const data = await response.json();

    if (!data.ok && data.validation_errors) {
      data.validation_errors.forEach((err) => {
        if (err.id) {
          const rows = document.querySelectorAll("#input-table tbody tr");
          rows.forEach((r) => {
            const idCell = r.querySelector("td:nth-child(1)");
            if (idCell && idCell.innerText.trim() === err.id) {
              r.classList.add("table-danger");
              r.title = err.msg;
            }
          });
        }
      });
    }
  } catch (e) {
    console.error("Validation check failed:", e);
  }
}

const debouncedValidate = debounce(() => {
  saveState();
  validateWithServer();
}, 500);

//File IO & Parsing
function handleFileUpload(event) {
  const input = event.target;
  const file = input.files[0];
  if (!file) {
    return;
  }
  const tbody = document.querySelector("#input-table tbody");
  if (tbody) {
    console.log("CLear up tbody.");
    tbody.innerHTML = "";
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    try {
      const tasks = parseCpmCsv(text);
      applyTasksToTable(tasks);
    } catch (err) {
      alert("Failed to import CSV: " + err.message);
      console.error(err);
    }
  };
  reader.readAsText(file);
}

function parseCpmCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length < 2)
    throw new Error("CSV must contain a header and at least one data row.");

  const headerLow = lines[0].toLowerCase();
  const isPert =
    headerLow.includes("optimistic") ||
    headerLow.includes("most") ||
    headerLow.includes("pessimistic") ||
    headerLow.includes("opt") ||
    headerLow.includes("m") ||
    headerLow.includes("pess"); //optimistic, most likely, pessimistic

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

/* Column layout: [0:ID][1:Name][2:Dur][3:Dep][4:Opt][5:ML][6:Pess][7:Del] */
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

//PERT mode helpers
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
        cells[2].textContent = fmt(expected);
      }
    }

    cells[2].classList.toggle("d-none", enabled); // Dur
    cells[4].classList.toggle("d-none", !enabled); // O
    cells[5].classList.toggle("d-none", !enabled); // M
    cells[6].classList.toggle("d-none", !enabled); // P
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

//Rendering (CPM, Gantt, Network)
function renderCpmSummary(result) {
  const box = document.getElementById("cpm-summary");
  const dur = result.project_duration;
  const criticalIds = (result.tasks || [])
    .filter((t) => t.critical && !t.is_dummy)
    .map((t) => t.id);

  let html = `
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1">Project Duration</div>
                    <div class="fw-bold fs-5 cpm-mono">${fmt(dur)} <span class="text-muted small">day(s)</span></div>
                </div>
            </div>
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1">Critical Path</div>
                    <div class="fw-semibold cpm-mono">${criticalIds.join(" → ") || "-"}</div>
                </div>
            </div>
            <div class="col-md-4 mb-2">
                <div class="border rounded p-2 h-100">
                    <div class="text-muted small mb-1"># Tasks</div>
                    <div class="fw-bold fs-5 cpm-mono">${(result.tasks || []).filter((t) => !t.is_dummy).length}</div>
                </div>
            </div>
        `;

  const ps = result.pert_stats;
  if (ps) {
    const dl = ps.deadlines;
    html += `
            <div class="col-12 mt-2">
                <div class="border rounded p-3 bg-light">
                    <div class="d-flex align-items-center gap-2 mb-2">
                        <span class="badge bg-primary">PERT</span>
                        <strong>Statistical Summary</strong>
                    </div>
                    <div class="row row-cols-2 row-cols-md-4 g-2 mb-3">
                        <div class="col">
                            <div class="small text-muted">E(T) — Expected</div>
                            <div class="cpm-mono fw-semibold">${fmt(ps.expected_duration)}</div>
                        </div>
                        <div class="col">
                            <div class="small text-muted">σ² — Variance</div>
                            <div class="cpm-mono fw-semibold">${fmt(ps.variance)}</div>
                        </div>
                        <div class="col">
                            <div class="small text-muted">σ — Std Dev</div>
                            <div class="cpm-mono fw-semibold">${fmt(ps.std_dev)}</div>
                        </div>
                    </div>
                    <div class="row row-cols-2 row-cols-md-5 g-2">
                        ${[
                          ["50%", dl.p50],
                          ["75%", dl.p75],
                          ["90%", dl.p90],
                          ["95%", dl.p95],
                          ["99%", dl.p99],
                        ]
                          .map(
                            ([label, val]) => `
                            <div class="col text-center">
                                <div class="small text-muted">${label} deadline</div>
                                <div class="cpm-mono fw-semibold text-primary">${fmt(val)}</div>
                            </div>`,
                          )
                          .join("")}
                    </div>
                </div>
            </div>`;
  }

  box.innerHTML = html;
  box.classList.remove("d-none");
}

function renderCpmTable(result) {
  const mount = document.getElementById("cpm-table");
  const pert = isPertMode() && result.pert_stats;
  const tasks = (result.tasks || []).filter(
    (t) => !String(t.id).includes("Dummy") && !t.is_dummy,
  );
  tasks.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const pertCols = pert ? ["O", "M", "P", "σ²"] : [];
  const baseCols = [
    "ID",
    "Name",
    pert ? "E(t)" : "Duration",
    ...pertCols,
    "ES",
    "EF",
    "LS",
    "LF",
    "Slack",
    "Dependencies",
    "Critical",
  ];

  const header = `<thead><tr>${baseCols.map((h) => `<th>${h}</th>`).join("")}</tr></thead>`;

  const body = tasks
    .map((t) => {
      const deps = (t.dependencies || []).join(", ");
      const rowClass = t.critical ? "cpm-row-critical" : "";
      const pertCells = pert
        ? [
            `<td class="cpm-mono" title="Optimistic">${fmt(t.optimistic)}</td>`,
            `<td class="cpm-mono" title="Most Likely">${fmt(t.most_likely)}</td>`,
            `<td class="cpm-mono" title="Pessimistic">${fmt(t.pessimistic)}</td>`,
            `<td class="cpm-mono" title="Variance">${fmt(t.variance)}</td>`,
          ]
        : [];

      const cells = [
        `<td class="cpm-mono">${t.id}</td>`,
        `<td class="cpm-mono">${t.name}</td>`,
        `<td class="cpm-mono">${fmt(t.duration)}</td>`,
        ...pertCells,
        `<td class="cpm-mono" title="Early Start">${fmt(t.es)}</td>`,
        `<td class="cpm-mono" title="Early Finish">${fmt(t.ef)}</td>`,
        `<td class="cpm-mono" title="Late Start">${fmt(t.ls)}</td>`,
        `<td class="cpm-mono" title="Late Finish">${fmt(t.lf)}</td>`,
        `<td class="cpm-mono" title="Total Slack">${fmt(t.slack)}</td>`,
        `<td class="cpm-mono">${deps}</td>`,
        `<td>${
          t.critical ? '<span class="badge badge-critical">Critical</span>' : ""
        }</td>`,
      ];
      return `<tr class="${rowClass}">${cells.join("")}</tr>`;
    })
    .join("");

  mount.innerHTML = `<table class="cpm-table">${header}<tbody>${body}</tbody></table>`;
}

function parseISODate(iso) {
  return new Date(iso + "T00:00:00");
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function toISODate(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  d.setMinutes(d.getMinutes() - offset);
  return d.toISOString().slice(0, 10);
}

function mapCpmToGantt(result) {
  if (!result || !Array.isArray(result.tasks))
    throw new Error("Invalid CPM result: missing tasks array.");
  const startISO = result.project_start;
  if (!startISO) throw new Error("Invalid CPM result: missing project_start.");
  const startBase = parseISODate(startISO || toISODate(new Date()));

  const ganttTasks = result.tasks.filter(
    (t) => !String(t.id).includes("Dummy") && !t.is_dummy,
  );

  const items = ganttTasks.map((t) => {
    const depsArray = Array.isArray(t.dependencies) ? t.dependencies : [];
    const startDate = addDays(startBase, t.es);
    const endDate = addDays(startBase, t.ef);
    return {
      id: t.id,
      name: t.name || t.id,
      start: toISODate(startDate),
      end: toISODate(endDate),
      dependencies: depsArray.join(","),
      es: t.es,
      ef: t.ef,
      ls: t.ls,
      lf: t.lf,
      slack: t.slack,
      critical: t.critical,
    };
  });
  return { projectStart: startBase, items };
}

function renderGantt(result) {
  const BAR_HEIGHT = 20;
  const ROW_PADDING = 10;
  const HEADER_HEIGHT = 50;
  const items = result.items.map((t) => {
    const startISO = toISODate(addDays(result.projectStart, t.es));
    const endISO = toISODate(addDays(result.projectStart, t.lf - 1));

    const windowDays = Math.max(1, t.lf - t.es);
    const durDays = Math.max(0, t.ef - t.es);
    const fillPercent = Math.min(100, Math.round((durDays / windowDays) * 100));

    return {
      id: t.id,
      name: t.name,
      start: startISO,
      end: endISO,
      progress: fillPercent,
      dependencies: t.dependencies || "",
      custom_class: t.critical ? "crit" : "noncrit",
      cpm: { es: t.es, ef: t.ef, ls: t.ls, lf: t.lf, slack: t.slack },
    };
  });

  const EXTRA_BOTTOM_ROWS = 2;
  for (let i = 0; i < EXTRA_BOTTOM_ROWS; i++) {
    const anchorISO = items[0]?.start || toISODate(result.projectStart);
    items.push({
      id: `__spacer_${i}`,
      name: "",
      start: anchorISO,
      end: anchorISO,
      progress: 0,
      dependencies: "",
      custom_class: "spacer",
    });
  }
  const mount = document.getElementById("gantt");
  mount.innerHTML = "";
  const rows = items.length;
  const minH = rows * (BAR_HEIGHT + ROW_PADDING) + HEADER_HEIGHT + 80;
  mount.style.minHeight = Math.max(minH, 360) + "px";

  new Gantt(mount, items, {
    view_mode: "Day",
    bar_height: BAR_HEIGHT,
    padding: ROW_PADDING,
    column_width: 36,
    fit_width: false,
    popup_on: "click",
  });
}

function scrollToFirstGanttTask() {
  const container = document.querySelector(".gantt-container");
  if (!container) return;
  const firstBar = container.querySelector(".bar-group");
  if (firstBar) {
    const rect = firstBar.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTo({
      left: rect.left - containerRect.left + container.scrollLeft - 50,
      behavior: "smooth",
    });
  }
}

function makeNodeSvg(nodeLabel, earliest, latest) {
  const size = 90;
  const r = 43;
  const cx = 45,
    cy = 45;
  const borderColor = "#2c1810";
  const fmtVal = (v) => (v === undefined || v === null ? "?" : fmt(v));

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="white" stroke="${borderColor}" stroke-width="2.5"/>
            <line x1="${cx - r + 1}" y1="${cy}" x2="${cx + r - 1}" y2="${cy}" stroke="${borderColor}" stroke-width="1.8"/>
            <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy + r - 1}" stroke="${borderColor}" stroke-width="1.8"/>
            <text x="${cx}" y="${cy - 10}" text-anchor="middle" dominant-baseline="middle"
                font-family="monospace" font-size="13" font-weight="700" fill="${borderColor}">${nodeLabel}</text>
            <text x="${cx - 14}" y="${cy + 22}" text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-size="17" font-weight="600" fill="#1a6e3c">${fmtVal(earliest)}</text>
            <text x="${cx + 14}" y="${cy + 22}" text-anchor="middle" dominant-baseline="middle"
                font-family="Georgia,serif" font-size="17" font-weight="600" fill="#1a47a0">${fmtVal(latest)}</text>
        </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function makeAoNNodeSvg(id, duration, es, ef, ls, lf, slack, critical) {
  const w = 130,
    h = 90;
  const fmtVal = (v) => (v === undefined || v === null ? "?" : fmt(v));
  const border = critical ? "#b83232" : "#1a47a0";
  const headerBg = critical ? "#b83232" : "#1a47a0";
  const slackColor = slack == 0 ? "#b83232" : "#1a6e3c";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
            <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="8" ry="8"
                fill="white" stroke="${border}" stroke-width="2"/>
            <rect x="1" y="1" width="${w - 2}" height="26" rx="8" ry="8" fill="${headerBg}"/>
            <rect x="1" y="15" width="${w - 2}" height="12" fill="${headerBg}"/>

            <text x="${w / 2}" y="17" text-anchor="middle" dominant-baseline="middle"
                font-family="monospace" font-size="10" font-weight="700" fill="white">${id}  (dur: ${fmtVal(duration)}, slack: ${fmtVal(slack)})</text>

            <line x1="1" y1="27" x2="${w - 1}" y2="27" stroke="${border}" stroke-width="1.2"/>
            <line x1="${w / 2}" y1="27" x2="${w / 2}" y2="${h - 1}" stroke="${border}" stroke-width="1.2"/>
            <line x1="1" y1="58" x2="${w - 1}" y2="58" stroke="${border}" stroke-width="1.2"/>

            <text x="${w / 4}" y="35" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">ES</text>
            <text x="${(w * 3) / 4}" y="35" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">EF</text>
            <text x="${w / 4}" y="49" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a6e3c">${fmtVal(es)}</text>
            <text x="${(w * 3) / 4}" y="49" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a6e3c">${fmtVal(ef)}</text>

            <text x="${w / 4}" y="66" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">LS</text>
            <text x="${(w * 3) / 4}" y="66" text-anchor="middle" font-family="monospace" font-size="9" fill="#555">LF</text>
            <text x="${w / 4}" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a47a0">${fmtVal(ls)}</text>
            <text x="${(w * 3) / 4}" y="80" text-anchor="middle" font-family="Georgia,serif" font-size="14" font-weight="600" fill="#1a47a0">${fmtVal(lf)}</text>
        </svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function buildAoNElementsFromResult(aon) {
  if (!aon) {
    throw new Error(`No data for building AoN graph.`);
  }
  const nodes = aon.nodes.map((n) => ({
    data: {
      id: n.id,
      label: "",
      bgImage: makeAoNNodeSvg(
        n.id,
        n.duration,
        n.es,
        n.ef,
        n.ls,
        n.lf,
        n.slack,
        n.critical,
      ),
    },
    classes: n.critical ? "crit" : "noncrit",
  }));
  const edges = aon.edges.map((e) => ({
    data: {
      id: e.id,
      source: e.source,
      target: e.target,
    },
  }));
  return [...nodes, ...edges];
}

function buildAoAElementsFromResult(aoa) {
  if (!aoa) throw new Error("No data for building AoA graph.");
  const nodes = aoa.nodes.map((n) => ({
    data: {
      id: String(n.id),
      label: "",
      data_label: String(n.data_label || n.label),
      earliest: n.earliest,
      latest: n.latest,
      bgImage: makeNodeSvg(String(n.id), n.earliest, n.latest),
    },
  }));
  const edges = aoa.tasks
    .filter((t) => t.tail_node != null && t.head_node != null)
    .map((t) => {
      const isDummy = t.is_dummy === true;
      const classes = [t.critical ? "crit" : "noncrit", isDummy ? "dummy" : ""]
        .join(" ")
        .trim();
      return {
        data: {
          id: String(t.id),
          source: String(t.tail_node),
          target: String(t.head_node),
          label: isDummy ? `${t.id}` : `${t.id} ${fmt(t.duration)}`,
          duration: t.duration,
          es: fmt(t.es),
          ef: fmt(t.ef),
          ls: fmt(t.ls),
          lf: fmt(t.lf),
          slack: fmt(t.slack),
          isDummy,
        },
        classes,
      };
    });
  return [...nodes, ...edges];
}

function ensureCy() {
  if (cy) return cy;
  cy = cytoscape({
    container: document.getElementById("cpm-network"),
    elements: [],
    boxSelectionEnabled: false,
    style: CY_STYLE,
  });
  return cy;
}

function renderNetwork(mode) {
  const cy = ensureCy();
  cy.elements().remove();
  cy.add(mode === "aon" ? aonElements : aoaElements);
  cy.layout({
    name: "dagre",
    rankDir: "LR",
    rankSep: 120,
    nodeSep: 60,
    edgeSep: 20,
    padding: 30,
  }).run();
  cy.fit(undefined, 30);
}

function initOrUpdateNetwork() {
  const toggle = document.getElementById("toggle-network-mode");
  const mode = toggle && toggle.checked ? "aon" : "aoa";
  renderNetwork(mode);
  if (toggle && !toggle._handlerAttached) {
    toggle.addEventListener("change", () => {
      const newMode = toggle.checked ? "aon" : "aoa";
      renderNetwork(newMode);
    });
    toggle._handlerAttached = true;
  }
}
