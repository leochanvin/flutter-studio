import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

// ------- Config -------
const GH_OWNER = process.env.GH_OWNER || "leochanvin";
const TEMPLATE_OWNER = process.env.TEMPLATE_OWNER || "leochanvin";
const TEMPLATE_REPO = process.env.TEMPLATE_REPO || "flutter-studio-template";
const GH_TOKEN = process.env.GH_TOKEN; // injecté via Secret Manager

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

// Arbre "simple" par nom de branche (utile quand le dépôt est déjà bien visible)
async function getRepoTree({ owner, repo, branch = "main" }) {
  return gh(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
  );
}

// ------ Correctif de cohérence éventuelle (409/empty/404) ------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Convertit la réponse /contents en un arbre minimal {name,type,children}
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

// Aide pour transformer un arbre imbriqué en liste façon /git/trees
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

/**
 * Essaie plusieurs méthodes pour récupérer l'arbre et réessaie jusqu'à readiness.
 * Stratégies par ordre:
 *  A) /git/trees/{branch}?recursive=1
 *  B) /branches/{branch} -> sha -> /git/trees/{sha}?recursive=1
 *  C) /contents?ref={branch}  (converti en shape compatible)
 */
async function getRepoTreeWithRetry({
  owner,
  repo,
  branch = "main",
  tries = 60,        // ~2 minutes au total
  interval = 2000,   // 2s entre essais
}) {
  for (let i = 0; i < tries; i++) {
    // A) direct par nom de branche
    try {
      const byBranch = await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`
      );
      if (byBranch?.tree?.length) return byBranch;
    } catch (_) {}

    // B) via SHA du commit de la branche
    try {
      const br = await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(branch)}`
      );
      const sha = br?.commit?.sha;
      if (sha) {
        const bySha = await gh(
          `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(sha)}?recursive=1`
        );
        if (bySha?.tree?.length) return bySha;
      }
    } catch (_) {}

    // C) fallback via /contents
    try {
      const contents = await gh(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents?ref=${encodeURIComponent(branch)}`
      );
      if (Array.isArray(contents) && contents.length) {
        const minimalTree = contentsToTree(contents, repo);
        return { sha: null, truncated: false, tree: flattenNestedTree(minimalTree) };
      }
    } catch (_) {}

    await sleep(interval);
  }
  throw new Error("timeout_waiting_for_repo_ready");
}

// ----------------------------------------------------------

/**
 * POST /generate-repo
 * Body: { projectName: string, owner?: string, private?: boolean }
 * Effet: crée un nouveau repo GitHub à partir du template GitHub, sans modifier les fichiers.
 * Retour: infos du repo + arbo (tree) pour affichage dans l'UI.
 */
app.post("/generate-repo", async (req, res) => {
  try {
    const projectName = (req.body?.projectName || "flutter_studio").trim();
    const owner = (req.body?.owner || GH_OWNER).trim();
    const isPrivate = !!req.body?.private;

    if (!projectName) return res.status(400).json({ ok: false, error: "missing_project_name" });
    if (!GH_TOKEN) return res.status(500).json({ ok: false, error: "missing_github_token" });

    // 1) Create repository using template
    const created = await gh(
      `/repos/${encodeURIComponent(TEMPLATE_OWNER)}/${encodeURIComponent(TEMPLATE_REPO)}/generate`,
      {
        method: "POST",
        body: JSON.stringify({
          owner,
          name: projectName,
          private: isPrivate,
          include_all_branches: false
        })
      }
    );

    // 2) Récupère l’arbo (avec retry jusqu’à ce que le premier commit soit visible)
    const branch = created.default_branch || "main";

    let tree = null;
    try {
      tree = await getRepoTreeWithRetry({ owner, repo: created.name, branch });
    } catch (retryErr) {
      console.warn("Arbre non prêt après délai, on renvoie tout de même le repo:", retryErr?.message || retryErr);
    }

    res.json({
      ok: true,
      owner,
      repo: created.name,
      html_url: created.html_url,
      default_branch: branch,
      tree // peut être null si GitHub n'a pas fini l'indexation
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: "repo_generation_failed", message: e.message });
  }
});

app.get("/repo-info", async (req, res) => {
  try {
    const owner = (req.query.owner || GH_OWNER).trim();
    const repo = (req.query.repo || "").trim();
    if (!repo) return res.status(400).json({ error: "missing_repo" });
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