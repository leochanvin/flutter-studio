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
    const body = await r.text().catch(()=> "");
    throw new Error(`GitHub ${path} -> ${r.status} ${r.statusText}: ${body}`);
  }
  return r.json();
}

// GET arbo d'un repo (pour l'afficher dans l'UI)
async function getRepoTree({ owner, repo, branch = "main" }) {
  return gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
}

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

    if (!projectName) return res.status(400).json({ ok:false, error:"missing_project_name" });
    if (!GH_TOKEN) return res.status(500).json({ ok:false, error:"missing_github_token" });

    // 1) Appel "Create repository using a template"
    // Doc: POST /repos/{template_owner}/{template_repo}/generate
    const payload = {
      owner,                 // où créer le repo
      name: projectName,     // nom du repo créé
      private: isPrivate,
      include_all_branches: false
      // optionnel: description, etc.
    };
    const created = await gh(`/repos/${encodeURIComponent(TEMPLATE_OWNER)}/${encodeURIComponent(TEMPLATE_REPO)}/generate`, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    // 2) Récupère l’arborescence (branch par défaut = created.default_branch)
    const branch = created.default_branch || "main";
    const tree = await getRepoTree({ owner, repo: created.name, branch });

    res.json({
      ok: true,
      owner,
      repo: created.name,
      html_url: created.html_url,
      default_branch: branch,
      tree
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, error:"repo_generation_failed", message: e.message });
  }
});

app.get("/repo-info", async (req, res) => {
  try {
    const owner = (req.query.owner || GH_OWNER).trim();
    const repo = (req.query.repo || "").trim();
    if (!repo) return res.status(400).json({ error: "missing_repo" });
    const branch = (req.query.branch || "main").trim();
    const tree = await getRepoTree({ owner, repo, branch });
    res.json(tree);
  } catch (e) {
    res.status(500).json({ error: "repo_info_failed", message: e.message });
  }
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));