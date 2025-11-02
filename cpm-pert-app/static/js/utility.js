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

    console.log("toISODate(new Date()", toISODate(new Date()));
    console.log("parseISODate", parseISODate(startISO || toISODate(new Date())));

    const startBase = parseISODate(startISO || toISODate(new Date()));
    console.log("startBase", startBase);
    const items = result.tasks.map(t => {
        const depsArray = Array.isArray(t.dependencies) ? t.dependencies : [];
        const startDate = addDays(startBase, t.es);
        console.log("startDate", startDate);
        const endDate   = addDays(startBase, t.ef);
        console.log("endDate", endDate);

        return {
            id: t.id,
            name: t.name || t.id,
            start: startDate,
            end: endDate,
            dependencies: depsArray.join(","),
            cpm: { es: t.es, ef: t.ef, ls: t.ls, lf: t.lf, slack: t.slack, critical: t.critical }
        };
    });
    
    return { projectStartISO: toISODate(startBase), items}
}