# Flutter Tree (API + Viewer)

- **API** (Cloud Run) : `POST /generate-tree` retourne une arborescence JSON d'un projet Flutter (sans code).
- **Viewer** (GitHub Pages) : interface statique pour explorer l'arborescence.

## Appeler l'API
```bash
curl -X POST https://YOUR-CLOUD-RUN-URL/generate-tree \
  -H 'Content-Type: application/json' \
  -d '{"projectName":"MonAppli","platforms":["android","ios","web"],"includeExamples":true}'