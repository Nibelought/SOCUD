# SOCUD web app

Next.js 16 (App Router), React 19, Tailwind CSS 4, Tiptap 2 + Yjs for collaborative editing.
See the repository README for running the whole stack; the interface design system and the rules
for extending it are in [DESIGN.md](DESIGN.md).

```bash
npm run dev        # http://localhost:3001
npm run typecheck
npm run lint
npm test
npm run api:gen    # regenerate src/lib/api/schema.d.ts from ../socud-backend/openapi.json
```

## Structure

```text
src/
  app/
    (auth)/          sign in, create account
    (app)/           signed-in screens, wrapped in the app shell (layout.tsx)
      dashboard/     Home
      space/         a space's documents; /space/create
      document/      reader (/document/:id/view), editor (/document/:id), /document/create
      graph/         knowledge graph
    globals.css      design tokens and document styles
  components/
    ui/              buttons, fields, sheets, menus, feedback, small parts
    shell/           app shell, sidebar, toolbar, page structure, app context
    documents/ spaces/ sharing/ search/ graph/ editor/ admin/
  hooks/             useResource (cached data), useMediaQuery, useDocumentTitle
  lib/               API client, auth/session, queries, formatting, space colors, security
```
