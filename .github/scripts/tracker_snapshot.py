"""Build the snapshot shown by the pinned IAM Platform Tracker app.

Usage: python3 .github/scripts/tracker_snapshot.py > snapshot.json   (needs the gh CLI; REST only)
The scheduled refinement task writes the output to the app's database (collection "board", doc "snapshot").
"""
import json, re, subprocess, datetime

R = "repos/Product-Platform-Solutions/iam-platform"

def get(path):
    out = subprocess.run(["gh", "api", "--paginate", f"{R}/{path}"], capture_output=True, text=True, check=True).stdout
    return json.loads(out.replace("][", ","))

def plan(i):
    m = re.search(r"\*\*Planning\*\*\s*\n\|([^\n]+)\|\s*\n\|[-| :]+\|\s*\n\|([^\n]+)\|", i.get("body") or "")
    return dict(zip([x.strip().lower() for x in m.group(1).split("|")], [x.strip() for x in m.group(2).split("|")])) if m else {}

issues = get("issues?state=all&per_page=100")
prs = get("pulls?state=open&per_page=100")
branches = [b["name"] for b in get("branches?per_page=100")]
in_prog = {int(m.group(1)) for b in branches if (m := re.match(r"(?:feat|fix|chore)/(\d+)\b", b))}
in_rev = set()
for p in prs:
    if m := re.match(r"(?:feat|fix|chore)/(\d+)\b", p["head"]["ref"]): in_rev.add(int(m.group(1)))
    for m in re.finditer(r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)", p.get("body") or "", re.I): in_rev.add(int(m.group(1)))
typ = lambda i: (i.get("type") or {}).get("name")
def status(i):
    if "pull_request" in i: return "done" if i["state"] == "closed" else "review"
    if i["state"] == "closed": return "done"
    if i["number"] in in_rev: return "review"
    if i["number"] in in_prog: return "progress"
    return "backlog"
by_n = {i["number"]: i for i in issues}
par = lambda i: int((i.get("parent_issue_url") or "/0").rsplit("/", 1)[1])
phases = []
for ini in sorted([i for i in issues if typ(i) == "Initiative" and i.get("milestone")], key=lambda i: i["milestone"]["title"]):
    ms = ini["milestone"]["title"]; p = plan(ini)
    mine = [i for i in issues if (i.get("milestone") or {}).get("title") == ms]
    items = []
    for i in mine:
        if not (typ(i) in ("Story", "Spike") or ("pull_request" in i and i["state"] == "open")): continue
        if i.get("state_reason") == "not_planned": continue
        e = by_n.get(par(i)); pi = plan(i)
        items.append({"n": i["number"], "title": i["title"], "status": status(i),
                      "points": int((re.match(r"\d+", pi.get("estimate", "")) or [0])[0]),
                      "priority": pi.get("priority", "Medium").lower(), "epic": par(i),
                      "epicTitle": re.sub(r"^\[P\d+\]\s*", "", e["title"]) if e else ""})
    items.sort(key=lambda x: (x["epic"] or 0, x["n"]))
    phases.append({"key": ms.split()[0], "title": ms.split(" ", 1)[1], "goal": (ini.get("body") or "").split("\n")[0],
                   "start": p.get("start"), "due": p.get("target"), "epic": {"n": ini["number"], "url": ini["html_url"]}, "items": items})
print(json.dumps({"syncedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                  "repo": "Product-Platform-Solutions/iam-platform", "repoUrl": "https://github.com/Product-Platform-Solutions/iam-platform",
                  "phases": phases, "prs": [{"n": p["number"], "title": p["title"], "url": p["html_url"], "draft": p["draft"]} for p in prs]}))
