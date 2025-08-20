import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// ------- Config -------
const GH_OWNER = process.env.GH_OWNER || "leochanvin";
const TEMPLATE_OWNER = process.env.TEMPLATE_OWNER || "leochanvin";
const TEMPLATE_REPO = process.env.TEMPLATE_REPO || "flutter-studio-template";
const GH_TOKEN = process.env.GH_TOKEN;

if (!GH_TOKEN) {
  console.warn("⚠️ GH_TOKEN non défini. Configure un secret gh-token et mappe-le à GH_TOKEN.");
}

// --- GitHub helpers ---
async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...opts,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${GH_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {})
    }
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`GitHub ${path} -> ${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

// ------ Retry multi-stratégies ------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function contentsToTree(contents, rootName = "repo") {
  const root = { name: rootName, type: "dir", children: [] };
  for (const item of contents) {
    const parts = (item.path || "").split("/").filter(Boolean);
    let parent = root;
    parts.forEach((part, i) => {
      const isLast = i === parts.length - 1;
      let node = (parent.children || []).find((c) => c.name === part);
      if (!node) {
        node = { name: part, type: isLast && item.type === "file" ? "file" : "dir" };
        if (node.type === "dir") node.children = [];
        parent.children.push(node);
      }
      parent = node;
    });
  }
  return root;
}
function flattenNestedTree(node, base = "") {
  const items = [];
  if (node.type === "dir" && node.children) {
    for (const c of node.children) {
      const path = base ? `${base}/${c.name}` : c.name;
      items.push({ path, type: c.type === "dir" ? "tree" : "blob" });
      if (c.type === "dir") items.push(...flattenNestedTree(c, path));
    }
  }
  return items;
}
async function getRepoTreeWithRetry({ owner, repo, branch = "main", tries = 60, interval = 2000 }) {
  for (let i = 0; i < tries; i++) {
    try {
      const byBranch = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
      if (byBranch?.tree?.length) return byBranch;
    } catch {}
    try {
      const br = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`);
      const sha = br?.commit?.sha;
      if (sha) {
        const bySha = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`);
        if (bySha?.tree?.length) return bySha;
      }
    } catch {}
    try {
      const contents = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`);
      if (Array.isArray(contents) && contents.length) {
        const minimalTree = contentsToTree(contents, repo);
        return { sha: null, truncated: false, tree: flattenNestedTree(minimalTree) };
      }
    } catch {}
    await sleep(interval);
  }
  throw new Error("timeout_waiting_for_repo_ready");
}

// ------- Routes -------
app.post("/generate-repo", async (req, res) => {
  try {
    const projectName = (req.body?.projectName || "flutter_studio").trim();
    const owner = (req.body?.owner || GH_OWNER).trim();
    const isPrivate = !!req.body?.private;

    if (!projectName) return res.status(400).json({ ok: false, error: "missing_project_name" });
    if (!GH_TOKEN) return res.status(500).json({ ok: false, error: "missing_github_token" });

    const created = await gh(`/repos/${encodeURIComponent(TEMPLATE_OWNER)}/${encodeURIComponent(TEMPLATE_REPO)}/generate`, {
      method: "POST",
      body: JSON.stringify({ owner, name: projectName, private: isPrivate, include_all_branches: false })
    });

    const branch = created.default_branch || "main";
    let tree = null;
    try {
      tree = await getRepoTreeWithRetry({ owner, repo: created.name, branch });
    } catch (e) {
      console.warn("Arbre non prêt après délai, on renvoie quand même:", e.message || e);
    }

    res.json({ ok: true, owner, repo: created.name, html_url: created.html_url, default_branch: branch, tree });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "repo_generation_failed", message: e.message });
  }
});

app.get("/repo-info", async (req, res) => {
  try {
    const owner = (req.query.owner || GH_OWNER).trim();
    const repo = (req.query.repo || "").trim();
    const branch = (req.query.branch || "main").trim();
    const tree = await getRepoTreeWithRetry({ owner, repo, branch });
    res.json(tree);
  } catch (e) {
    res.status(500).json({ error: "repo_info_failed", message: e.message });
  }
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));