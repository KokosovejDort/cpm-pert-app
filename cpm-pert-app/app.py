from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
PROJECT = {"tasks": []}

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/health")
def health():
    return jsonify({"ok": True})

@app.get("/api/tasks")
def get_tasks():
    return jsonify(PROJECT["tasks"])

@app.post("/api/tasks")
def set_tasks():
    data = request.get_json(force=True) or {}
    PROJECT["tasks"] = data.get("tasks", [])
    return jsonify({"message": "Tasks updated"})

if __name__ == "__main__":
    app.run(debug=True)