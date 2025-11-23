function fmt(x) {
    return Number(x).toFixed(2).replace(/\.00$/, "");
}

function handleFileUpload(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) {
        return
    }
    const tbody = document.querySelector("#input-table tbody");
    if (tbody) {
        console.log("CLear up tbody.")
        tbody.innerHTML = "";
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const text = e.target.result;
        try {
            const tasks = parseCpmCsv(text);
            applyTasksToTable(tasks);
        }
        catch (err) {
            alert("Failed to import CSV: " + err.message);
            console.error(err);
        }
    }
    reader.readAsText(file);
}

function parseCpmCsv(text) {
    const lines = text
        .split(/\r?\n/)              
        .map(l => l.trim())          
        .filter(l => l.length > 0);

    if (lines.length < 2) {
        throw new Error("CSV must contain a header and at least one data row.");
    }
    const dataLines = lines.slice(1);
    const tasks = []
    dataLines.forEach((line, idx) => {
        const rowNumber = idx + 2;
        const cols = line.split(",").map(c => c.trim());
        if (cols.length < 3) {
            throw new Error(`Row ${rowNumber}: expected at least 3 columns (ID, predecessors, duration).`);
        }
        const idRaw = cols[0] || "";
        const prRaw = cols[1] || "";
        const duRaw = cols[2] || "";
        if (!idRaw) {
            throw new Error(`Row ${rowNumber}: missing activity ID in first column.`);
        }
        const duration = Number(duRaw);
        if (!isFinite(duration)) {
            throw new Error(`Row ${rowNumber}: invalid duration '${duRaw}'.`);
        }
        const depsArray = parseCsvPredecessors(prRaw);
        tasks.push({
            id: idRaw,
            name: idRaw,                     
            duration: String(duration),      
            dependencies: depsArray.join(", ")  
        });
    });
    return tasks;
}

function applyTasksToTable(tasks) {
    const tbody = document.querySelector("#input-table tbody");
    tbody.innerHTML = "";
    tasks.forEach(task => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td contenteditable="true"></td>
            <td contenteditable="true"></td>
            <td contenteditable="true"></td>
            <td contenteditable="true"></td>
            <td><button class="btn-del">Delete</button></td>
        `;
        const cells = tr.querySelectorAll("td");
        cells[0].textContent = task.id;  
        cells[1].textContent = task.name || task.id; 
        cells[2].textContent = String(task.duration || "0");
        cells[3].textContent = task.dependencies || "";
        tbody.appendChild(tr);
    });
}

function parseCsvPredecessors(prCell) {
    const trimmed = (prCell || "").trim();
    if (!trimmed || trimmed === "-") {
        return [];
    }
    if (/[,\s;]/.test(trimmed)) {
        return trimmed
            .split(/[,\s;]+/)
            .map(x => x.trim())
            .filter(Boolean);
    }
    return trimmed.split("").filter(Boolean);
}

function parseDependencies(dependenciesText) {
    if (!dependenciesText) return [];

    const dependencies = dependenciesText.split(/[,;]/).map(dep => dep.trim()).filter(Boolean);
    return dependencies
}

function readTable() {
    const rows = document.querySelectorAll("#input-table tbody tr");

    const tasks = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll("td");

        const id = cells[0].textContent.trim();
        const name = cells[1].textContent.trim();
        const duration = Number(cells[2].textContent.trim() || "0");
        const dependencies = cells[3].textContent.trim();

        if (id) {
            const task = {
                id: id,
                name: name,
                duration: duration,
                dependencies: parseDependencies(dependencies) 
            };
            tasks.push(task);
        }
    }
    return tasks;
}

function renderCpmSummary(result) {
    const box = document.getElementById("cpm-summary");
    const dur = result.project_duration;
    const criticalIds = (result.tasks || [])
      .filter(t => t.critical)
      .map(t => t.id);
  
    box.innerHTML = `
      <div><strong>Project duration:</strong> <span class="cpm-mono">${dur}</span> day(s)</div>
      <div><strong>Critical path:</strong> <span class="cpm-mono">${criticalIds.join(" → ") || "-"}</span></div>
      <div><strong># Tasks:</strong> <span class="cpm-mono">${result.tasks?.length || 0}</span></div>
    `;
  }
  
function renderCpmTable(result) {
    const mount = document.getElementById("cpm-table");
    const tasks = Array.isArray(result.tasks) ? result.tasks : [];
    tasks.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const headerCols = [
        "ID",
        "Name",
        "Duration",
        "ES",
        "EF",
        "LS",
        "LF",
        "Slack",
        "Dependencies",
        "Critical"
    ];
  
    const header = `
    <thead>
      <tr>${headerCols.map(h => `<th>${h}</th>`).join("")}</tr>
    </thead>`;
  
    const body = tasks.map(t => {
        const deps = Array.isArray(t.dependencies) ? t.dependencies.join(", ") : "";
        const rowClass = t.critical ? "cpm-row-critical" : "";

        const cells = [
            `<td class="cpm-mono">${t.id}</td>`,
            `<td class="cpm-mono">${t.name}</td>`,
            `<td class="cpm-mono">${fmt(t.duration)}</td>`,
            `<td class="cpm-mono" title="Early Start">${fmt(t.es)}</td>`,
            `<td class="cpm-mono" title="Early Finish">${fmt(t.ef)}</td>`,
            `<td class="cpm-mono" title="Late Start">${fmt(t.ls)}</td>`,
            `<td class="cpm-mono" title="Late Finish">${fmt(t.lf)}</td>`,
            `<td class="cpm-mono" title="Total Slack">${fmt(t.slack)}</td>`,
                    `<td class="cpm-mono">${deps}</td>`,
            `<td>${t.critical ? '<span class="badge badge-critical">Critical</span>' : ""}</td>`
        ];

        return `<tr class="${rowClass}">${cells.join("")}</tr>`;
    }).join("")
    mount.innerHTML = `<table class="cpm-table">${header}<tbody>${body}</tbody></table>`;
}

function getNextId() {
    const rows = document.querySelectorAll("#input-table tbody tr");
    if (rows.length === 0)
        return "A";

    const lastRow = rows[rows.length - 1]
    const lastId = lastRow.querySelectorAll("td")[0].textContent.trim();
    if (lastId.match(/^[A-Y]$/)) 
        return String.fromCharCode(lastId.charCodeAt(0) + 1);
    if (lastId === "Z") 
        return "A1";
    if (lastId.match(/^[A-Z]\d+$/)) {
        const letter = lastId[0];
        const number = parseInt(lastId.slice(1));
        
        if (letter !== "Z") 
            return String.fromCharCode(letter.charCodeAt(0) + 1) + number;
        else 
            return "A" + (number + 1);
        
    }
    return "A";
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
    if (!result || !Array.isArray(result.tasks)) {
        throw new Error("Invalid CPM result: missing tasks array.");
    }
    const startISO = result.project_start; 
    if (!startISO) {
        throw new Error("Invalid CPM result: missing project_start.");
    }

    const startBase = parseISODate(startISO || toISODate(new Date()));
    const items = result.tasks.map(t => {
        const depsArray = Array.isArray(t.dependencies) ? t.dependencies : [];
        const startDate = addDays(startBase, t.es);
        const endDate   = addDays(startBase, t.ef);
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
            critical: t.critical 
        };
    });
    
    return { projectStart: startBase, items}
}

function renderGantt(result) {
    console.log('renderGantt v9 items:', result.items);
    const BAR_HEIGHT = 28;
    const ROW_PADDING = 22;
    const HEADER_HEIGHT = 56;

    const items = result.items.map(t => {
        const startISO = toISODate(addDays(result.projectStart, t.es));
        const endISO   = toISODate(addDays(result.projectStart, t.lf));

        const windowDays = Math.max(1, t.lf - t.es);
        const durDays    = Math.max(0, t.ef - t.es);
        const fillPercent   = Math.min(100, Math.round((durDays / windowDays) * 100));

        return {
            id: t.id,
            name: t.name,
            start: startISO,          
            end: endISO,              
            progress: fillPercent,                
            dependencies: t.dependencies || "",
            custom_class: t.critical ? "crit" : "noncrit",
            cpm: { es: t.es, ef: t.ef, ls: t.ls, lf: t.lf, slack: t.slack }
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
            custom_class: "spacer"     
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
        popup_on: "none"
    });
}

function renderCpmAoA(result) {
    const mount = document.getElementById("cpm-aoa");
    mount.innerHTML = "";
    const nodesData = result.nodes
    const tasks = result.tasks


    const nodes = nodesData.map(n => ({
        data: {
            id: String(n.id),        
            label: String(n.label),
            earliest: n.earliest,
            latest: n.latest
        }
    }));

    const edges = tasks.map(t => ({
        data: {
            id: String(t.id),
            source: String(t.tail_node),   
            target: String(t.head_node),   
            label: `${t.id} ${fmt(t.duration)}`,
            duration: t.duration,
            es: fmt(t.es),
            ef: fmt(t.ef),
            ls: fmt(t.ls),
            lf: fmt(t.lf),
            slack: fmt(t.slack)
        },
        classes: t.critical ? "crit" : "noncrit"
    }));

    const cy = cytoscape({
        container: mount,
        elements: { nodes, edges },
        style: [
            {
                selector: "node",
                style: {
                    "shape": "ellipse",
                    "width": 80,
                    "height": 80,
                    "background-color": "#ffffff",
                    "border-width": 2,
                    "border-color": "#000000",
                    "label": "data(label)",
                    "font-size": 14,
                    "text-valign": "center",
                    "text-halign": "center",
                    "color": "#000000"
                }
            },
            {
                selector: "edge",
                style: {
                    "width": 2,
                    "line-color": "#6b7280",
                    "target-arrow-color": "#6b7280",
                    "target-arrow-shape": "triangle",
                    "curve-style": "bezier",
                    "label": "data(label)",
                    "font-size": 12,
                    "text-margin-y": -8
                }
            },
            {
                selector: "edge.crit",
                style: {
                    "line-color": "#dc2626",
                    "target-arrow-color": "#dc2626",
                    "font-weight": "bold"
                }
            }
        ],
        layout: {
            name: "dagre",
            rankDir: "LR", 
            rankSep: 80,
            nodeSep: 40
        },
        userZoomingEnabled: false
    });
    cy.on("tap", "edge", evt => {
        const d = evt.target.data();
        alert(
            `Task ${d.id}\n` +
            `Duration: ${fmt(d.duration)}\n` +
            `ES/EF: ${fmt(d.es)} / ${fmt(d.ef)}\n` +
            `LS/LF: ${fmt(d.ls)} / ${fmt(d.lf)}\n` +
            `Slack: ${fmt(d.slack)}`
        );
    });
    cy.fit();
}