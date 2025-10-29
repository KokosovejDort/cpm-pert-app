class HttpError extends Error {
    constructor(status, bodyText) {
        super(`HTTP ${status}`);
        this.name = "HttpError";
        this.status = status;
        this.bodyText = bodyText; // raw string
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

function show(out, kind, text) {
    out.className = kind; 
    out.textContent = text;
  }

document.addEventListener("DOMContentLoaded", () => {
    const out = document.getElementById("out");
    const tbody = document.querySelector("tbody");

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

            if (!json || typeof json !== "object" || !json.result) {
                throw new Error("Invalid payload shape: missing 'result'.");
            }

            out.className = "ok";
            out.textContent = JSON.stringify(json.result, null, 2);

            let projectStartISO;
            let items;
            try {
                const mapped = mapCpmToGantt(json.result);
                projectStartISO = mapped.projectStartISO;
                items = mapped.items;
            } catch (mappingErr) {
                throw new MappingError(mappingErr.message);
            }
        }
        catch (err) {
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
            else {
                show(out, "error", `Network or script error:\n${err.message || err}`);
            }
        }
    }
});
