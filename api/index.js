import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());
app.use(cors());

// Charge le gabarit au démarrage
const tplPath = path.join(process.cwd(), "template_tree.json");
if (!fs.existsSync(tplPath)) {
  console.error("template_tree.json manquant dans /api");
  process.exit(1);
}
const TEMPLATE = JSON.parse(fs.readFileSync(tplPath, "utf-8"));

// Deep-clone + remplace le nom racine
function buildFromTemplate(projectName = "flutter_studio") {
  const clone = JSON.parse(JSON.stringify(TEMPLATE));
  clone.name = projectName || "__PROJECT_NAME__";
  return clone;
}

app.post("/generate-tree", (req, res) => {
  const { projectName = "flutter_studio" } = req.body ?? {};
  const tree = buildFromTemplate(projectName);
  res.json(tree);
});

// Expose le gabarit brut (debug)
app.get("/template-tree", (_req, res) => {
  res.json(TEMPLATE);
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));