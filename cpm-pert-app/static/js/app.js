mermaid.initialize({
    startOnLoad: false, 
    gantt: { useMaxWidth: false, leftPadding: 75 }
});

class HttpError extends Error {
    constructor(status, bodyText) {
        super(`HTTP ${status}`);
        this.name = "HttpError";
        this.status = status;
        this.bodyText = bodyText;
    }
}
class JsonParseError extends Error {
    constructor(message, rawText) {
        super(message);
        this.name = "JsonParseError";
        this.rawText = rawText;
    }
}
class MappingError extends Error {
    constructor(message) {
        super(message);
        this.name = "MappingError";
    }
}

class AoARenderError extends Error {
    constructor(message) {
        super(message);
        this.name = "AoARenderError";
    }
}

function show(out, kind, text) {
    out.className = kind; 
    out.textContent = text;
}

document.addEventListener("DOMContentLoaded", () => {

    loadState(); 

    const out = document.getElementById("out");
    const debugJson = document.getElementById("debug-json");
    const table = document.getElementById("input-table");
    const tbody = table ? table.querySelector("tbody") : null;
    const toggleJson = document.getElementById("toggle-json");

    if (toggleJson && debugJson) {
        toggleJson.addEventListener("change", () => {
            debugJson.classList.toggle("visible", toggleJson.checked);
        });
        debugJson.classList.toggle("visible", toggleJson.checked);
    }

    const btnHealth = document.getElementById("btn-health");
    if (btnHealth) {
        btnHealth.addEventListener("click", async () => {
            try {
                const res = await fetch("/api/health");
                out.textContent = JSON.stringify(await res.json(), null, 2);
            } catch (e) {
                out.textContent = "Error: " + e.message;
            }
        });
    }

    document.addEventListener("click", (e) => {
        if (e.target.classList.contains("btn-del")) {
            const row = e.target.closest("tr");
            if (row) {
                row.remove();
                saveState();
                validateWithServer(); 
            }
        }
    });

    if (table) {
        table.addEventListener("input", () => {
            debouncedValidate(); 
        });
    }

    const btnAdd = document.getElementById("btn-add");
    if (btnAdd) {
        btnAdd.addEventListener("click", () => {
            if (!tbody) {
                console.error("tbody is null, cannot append row");
                return;
            }
    
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td contenteditable="true">${getNextId()}</td>
                <td contenteditable="true"></td>
                <td contenteditable="true">0</td>
                <td contenteditable="true"></td>
                <td><button class="btn-del btn btn-sm btn-outline-danger">Delete</button></td>
            `;
            tbody.appendChild(tr);
            saveState(); 
            validateWithServer();
        });
    }

    const fileInput = document.getElementById("file-upload");
    if (fileInput) {
        fileInput.addEventListener("change", (e) => {
             handleFileUpload(e);
             setTimeout(() => {
                saveState();
                validateWithServer();
            }, 100);
        });
    }

    const btnAnalyze = document.getElementById("btn-analyze");
    if (btnAnalyze) {
        btnAnalyze.addEventListener("click", async () => {
            saveState(); 
            try {
                btnAnalyze.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Analyzing...';
                btnAnalyze.disabled = true;
            
                const tasksFromTable = readTable();
                const requestBody = JSON.stringify({ tasks: tasksFromTable });
                const response = await fetch("/api/analyze", {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: requestBody
                });

                const text = await response.text();
                let json;
                try { json = JSON.parse(text); }
                catch (jsonErr) { throw new JsonParseError(jsonErr.message, text); }

                if (!response.ok) {
                    if (json.validation_errors) {
                        document.querySelectorAll("#input-table tbody tr").forEach(row => row.classList.remove("table-danger"));
                        json.validation_errors.forEach(err => {
                            if (err.id) {
                                const rows = document.querySelectorAll("#input-table tbody tr");
                                rows.forEach(r => {
                                    const idCell = r.querySelector("td:nth-child(1)");
                                    if (idCell && idCell.innerText.trim() === err.id) {
                                        r.classList.add("table-danger");
                                        r.title = err.msg;
                                    }
                                });
                            }
                        });
                        throw new Error("Validation failed. Check highlighted rows.");
                    } else {
                        throw new HttpError(response.status, text);
                    }
                }

                if (!json || typeof json !== "object" || !json.result) {
                    throw new Error("Invalid payload shape: missing 'result'.");
                }
                document.querySelectorAll("#input-table tbody tr").forEach(row => {
                    row.classList.remove("table-danger");
                    row.title = "";
                });

                out.className = "ok";
                out.textContent = "Analysis completed successfully."; 
                if (debugJson) {
                    debugJson.textContent = JSON.stringify(json.result, null, 2);
                }
                renderCpmSummary(json.result);
                renderCpmTable(json.result);

                try {
                    const mapped = mapCpmToGantt(json.result);
                    renderGantt(mapped);
                } catch (mappingErr) {
                    throw new MappingError(mappingErr.message);
                }

                const aoaErrorContainer = document.getElementById("aoa-error");
                aoaErrorContainer.innerHTML = "";

                if (json.result.aoa_error) {
                    aoaErrorContainer.innerHTML = `
                        <div class="aoa-error-box">
                            <strong>AoA Network Not Supported</strong><br><br>
                            ${json.result.aoa_error}
                        </div>`;
                } 
                
                if (!json.result.aoa_error && Array.isArray(json.result.nodes) && json.result.nodes.length > 0) {
                    aoaElements = buildAoAElementsFromResult(json.result);
                } else {
                    aoaElements = []; 
                }
                aonElements = buildAoNElementsFromResult(json.result.aon);

                const networkTabBtn = document.getElementById("network-tab");
                const ganttTabBtn = document.getElementById("gantt-tab");
                if (networkTabBtn && ganttTabBtn) {
                    networkTabBtn.click();
                    setTimeout(() => {
                        initOrUpdateNetwork();
                        ganttTabBtn.click();
                        setTimeout(() => scrollToFirstGanttTask(), 50);
                    }, 10);
                } else {
                    initOrUpdateNetwork();
                }

            } catch (err) {
                document.getElementById("cpm-summary").innerHTML = "";
                document.getElementById("cpm-table").innerHTML = "";

                if (err instanceof HttpError) {
                    let msg = err.bodyText;
                    try {
                        const j = JSON.parse(err.bodyText);
                        msg = j.error || JSON.stringify(j, null, 2);
                    } 
                    catch { }
                    show(out, "error", `HttpError: Server returned an error:\n${msg}`);
                }
                else if (err instanceof JsonParseError) {
                    show(out, "warn", `Response OK but JSON parse failed.\n${err.message}\n\nRaw:\n${err.rawText}`);
                }
                else if (err instanceof MappingError) {
                    show(out, "error", `Mapping to Gantt data failed.\n${err.message}`);
                }
                else {
                    show(out, "error", `Network or script error:\n${err.message || err}`);
                }
            } finally {
                btnAnalyze.innerHTML = '<i class="bi bi-lightning-fill"></i> Analyze';
                btnAnalyze.disabled = false;
            }
        });
    }
});
