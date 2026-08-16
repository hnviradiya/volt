# Roadmap

- **[V1](ROADMAP-V1.md)** — a complete, accessible, production-usable component
  library on a framework that is fast and small. The framework core, the shared
  behaviours, every ordinary component, the data grid, the rich text editor,
  chat, SSR, developer tools, and the cross-cutting systems.
- **[V2](ROADMAP-V2.md)** — specialist surfaces, each a product in its own
  right: charts, the spreadsheet and its formula engine, scheduler, Gantt,
  Kanban, file manager, PDF viewer, maps, code editor, diagram canvas, and
  collaborative editing.

The split is by whether an application needs it before it can be built at all,
not by difficulty. The data grid and the rich text editor are both V1 and both
large.

What was considered and deliberately **not** done — proxies, dependency
injection, resumability, a Rust compiler, `:show`, a JavaScript animation
layer — is in [Design decisions](docs/guide/design-decisions.md) rather than
here. A roadmap should list work, not absences.
