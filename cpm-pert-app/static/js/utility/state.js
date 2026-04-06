// ── Persistence ───────────────────────────────────────────────────────────────

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

const debouncedValidate = debounce(() => {
  saveState();
  validateWithServer();
}, 500);
