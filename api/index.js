import express from "express";
import cors from "cors";

const app = express();
app.use(express.json());
app.use(cors());

function buildFlutterSkeleton(projectName = "flutter_app", platforms = []) {
  const defaultPlatforms = ["android","ios","web","macos","windows","linux"];
  const plat = new Set(platforms.length ? platforms : defaultPlatforms);

  const root = { name: projectName, type: "dir", children: [] };
  const push = (path) => {
    let node = root;
    for (const part of path) {
      const isFile = part.includes(".");
      node.children ??= [];
      let next = node.children.find(c => c.name === part);
      if (!next) {
        next = { name: part, type: isFile ? "file" : "dir" };
        if (!isFile) next.children = [];
        node.children.push(next);
      }
      node = next;
    }
  };

  // racine
  push(["pubspec.yaml"]);
  push(["analysis_options.yaml"]);
  push([".gitignore"]);
  push(["README.md"]);

  // sources
  push(["lib"]);
  push(["lib","main.dart"]);
  push(["test"]);
  push(["assets"]);

  // plateformes
  for (const p of plat) push([p]);

  return root;
}

app.post("/generate-tree", (req, res) => {
  const { projectName = "flutter_app", platforms = [], includeExamples = false } = req.body ?? {};
  const tree = buildFlutterSkeleton(projectName, platforms);

  if (includeExamples) {
    const assets = tree.children.find(c => c.name === "assets");
    assets?.children.push({ name: "images", type: "dir", children: [] });
    assets?.children.push({ name: "fonts", type: "dir", children: [] });
    const test = tree.children.find(c => c.name === "test");
    test?.children.push({ name: "widget_test.dart", type: "file" });
  }

  res.json(tree);
});

app.get("/health", (_req, res) => res.send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Listening on", port));