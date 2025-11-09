function parseDependencies(dependenciesText) {
    if (!dependenciesText) return [];

    const dependencies = dependenciesText.split(/[,;]/).map(dep => dep.trim()).filter(Boolean);
    return dependencies
}

function readTable() {
    const rows = document.querySelectorAll("tbody tr");

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
            `<td class="cpm-mono">${t.duration}</td>`,
            `<td class="cpm-mono" title="Early Start">${t.es}</td>`,
            `<td class="cpm-mono" title="Early Finish">${t.ef}</td>`,
            `<td class="cpm-mono" title="Late Start">${t.ls}</td>`,
            `<td class="cpm-mono" title="Late Finish">${t.lf}</td>`,
            `<td class="cpm-mono" title="Total Slack">${t.slack}</td>`,
            `<td class="cpm-mono">${deps}</td>`,
            `<td>${t.critical ? '<span class="badge badge-critical">Critical</span>' : ""}</td>`
        ];

        return `<tr class="${rowClass}">${cells.join("")}</tr>`;
    }).join("")
    mount.innerHTML = `<table class="cpm-table">${header}<tbody>${body}</tbody></table>`;
}

function getNextId() {
    const rows = document.querySelectorAll("tbody tr");
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
        olumn_width: 36,
        fit_width: false,
        popup_on: "none"
    });
}