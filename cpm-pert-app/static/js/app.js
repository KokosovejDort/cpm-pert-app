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
    const out = document.getElementById("out");
    const debugJson = document.getElementById("debug-json");
    const tbody = document.querySelector("tbody");

    const toggleJson = document.getElementById("toggle-json");
    if (toggleJson && debugJson) {
        const syncDebugVisibility = () => {
            debugJson.classList.toggle("visible", toggleJson.checked);
        };
        toggleJson.addEventListener("change", syncDebugVisibility);
        syncDebugVisibility();
    }

    document.getElementById("btn-health").onclick = async () => {
        const res = await fetch("/api/health");
        out.textContent = JSON.stringify(await res.json(), null, 2);
    };

    document.addEventListener("click", (e) => {
        if (e.target.classList.contains("btn-del")) {
            e.target.closest("tr").remove();
        }
    });

    document.getElementById("btn-add").onclick = () => {
        try {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td contenteditable="true">${getNextId()}</td><td contenteditable="true"></td><td contenteditable="true">0</td><td contenteditable="true"></td><td><button class="btn-del">Delete</button></td>`;            tbody.appendChild(tr);
        }
        catch (error) {
            console.log(error.message);
        }
    };
    
    document.getElementById("btn-save").onclick = async () => {
        try {
            const tasksParsed = readTable();
            const requestBody = JSON.stringify({ tasks: tasksParsed });

            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: requestBody
            });
            out.textContent = JSON.stringify(await res.json(), null, 2);
        }
        catch (error) {
            out.textContent = error.message;
        }
    };

    const fileInput = document.getElementById("file-upload");
    if (fileInput) {
        fileInput.addEventListener("change", handleFileUpload);
    }

    document.getElementById("btn-analyze").onclick = async () => {
        try {
            const tasksFromTable = readTable();
            const requestBody = JSON.stringify({ tasks: tasksFromTable });
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: requestBody
            });

            const text = await response.text();
            if (!response.ok) 
                throw new HttpError(response.status, text);

            let json;
            try { json = JSON.parse(text); }
            catch (jsonErr) { throw new JsonParseError(jsonErr.message, text); }
            console.log(json)

            if (!json || typeof json !== "object" || !json.result) {
                throw new Error("Invalid payload shape: missing 'result'.");
            }

            out.className = "ok";
            out.textContent = "Analysis completed successfully."; 
            if (debugJson) {
                debugJson.textContent = JSON.stringify(json.result, null, 2);
            }
            renderCpmSummary(json.result);
            renderCpmTable(json.result);
            document.getElementById("title-results").style.display = "block";

            try {
                const mapped = mapCpmToGantt(json.result);
                renderGantt(mapped);
                document.getElementById("title-gantt").style.display = "block";
            } catch (mappingErr) {
                throw new MappingError(mappingErr.message);
            }

            const aoaErrorContainer = document.getElementById("aoa-error");
            aoaErrorContainer.innerHTML = "";
            document.getElementById("title-aoa").style.display = "block";

            if (json.result.aoa_error) {
                aoaErrorContainer.innerHTML = `
<div class="aoa-error-box">
    <strong>AoA Network Not Supported</strong><br><br>
    ${json.result.aoa_error}
</div>
                `;
            } 
            if (!json.result.aoa_error &&
                Array.isArray(json.result.nodes) &&
                json.result.nodes.length > 0) {
            
                aoaElements = buildAoAElementsFromResult(json.result);
            } else {
                aoaElements = [];   // no AoA graph to show
            }
            aonElements = buildAoNElementsFromResult(json.result.aon);
            initOrUpdateNetwork();
        }
        catch (err) {
            document.getElementById("cpm-summary").innerHTML = "";
            document.getElementById("cpm-table").innerHTML = "";

            if (err instanceof HttpError) {
                let msg = err.bodyText;
                try {
                    const j = JSON.parse(err.bodyText);
                    msg = j.error || JSON.stringify(j, null, 2);
                } 
                catch {  }
                show(out, "error", `HttpError: Server returned an error:\n${msg}`);
            }
            else if (err instanceof JsonParseError) {
                show(out, "warn",
                `Response OK but JSON parse failed.\n\JsonParseError: ${err.message}\n\nRaw response:\n${err.rawText}`);
            }
            else if (err instanceof MappingError) {
                show(out, "error",
                `Mapping to Gantt data failed.\n\MappingError: ${err.message}`);
            }
            else if (err instanceof AoARenderError) {
                show(out, "error",
                `Rendering CPM network (AoA) failed.\n\AoARenderError: ${err.message}`);
            }
            else {
                show(out, "error", `Network or script error:\n${err.message || err}`);
            }
        }
    }
});
