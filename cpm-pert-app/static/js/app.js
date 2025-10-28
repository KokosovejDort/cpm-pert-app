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
        const tasksFromTable = readTable();
        out.className = "";
        out.textContent = "⏳ Analyzing...";
        try {
            const requestBody = JSON.stringify({ tasks: tasksFromTable });
            const response = await fetch("/api/analyze", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: requestBody
            });

            const text = await response.text();
            if (!response.ok) {
                let errorMsg;
                try {
                    const errJson = JSON.parse(text);
                    errorMsg = errJson.error || JSON.stringify(errJson, null, 2);
                } catch {
                    errorMsg = text || `HTTP ${response.status}`;
                }

                out.className = "error";
                out.textContent = "❌ Server returned an error:\n" + errorMsg;
                return;
            }

            let json;
            try 
            {
                json = JSON.parse(text); 
            } 
            catch {
                out.textContent =
                "Received response but failed to parse JSON.\n\n" +
                "Error: " + err.message + "\n\n" +
                "Raw response:\n" + text;
                return;
            }
            if (!json) {
                out.className = "warn";
                out.textContent =
                    "⚠️ Empty or invalid JSON received despite OK status.\n\nRaw:\n" + text;
                return;
            }
            out.textContent = JSON.stringify(json.result, null, 2);
        }
        catch (err) {
            out.textContent = "❌ Network or server error: " + err;
        }
    }
});
