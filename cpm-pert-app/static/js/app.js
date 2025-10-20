document.addEventListener("DOMContentLoaded", () => {
    const out = document.getElementById("out");
    document.getElementById("btn-health").onclick = async () => {
        const res = await fetch("/api/health");
        out.textContent = JSON.stringify(await res.json(), null, 2);
    };

    document.getElementById("btn-add").onclick = () => {
        const table = document.querySelector("tasks-table");
    };

    const tasks = document.getElementById("tasks");
    document.getElementById("btn-save").onclick = async () => {
        try {
            const tasksParsed = JSON.parse(tasks.value || "[]");
            const res = await fetch("/api/tasks", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({tasks: tasksParsed})
            });
            out.textContent = JSON.stringify(await res.json(), null, 2);
        }
        catch (error) {
            out.textContent = error.message;
        }
    };

    document.getElementById("btn-load").onclick = async () => {
        const res = await fetch("/api/tasks");
        tasks.value = JSON.stringify(await res.json(), null, 2);
    };
});
