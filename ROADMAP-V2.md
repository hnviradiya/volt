# Roadmap — V2

Specialist surfaces, each a product in its own right. None is needed before
an application has ordinary components to build with, and each carries an
engine of its own — a formula evaluator, a PDF renderer, map projections,
recurrence and timezone arithmetic. Deferred deliberately, not for lack of
interest. V1 is in [ROADMAP-V1.md](ROADMAP-V1.md).

| deferred | why it waits |
| --- | --- |
| Charts and gauges | ~70 series types plus axes, legends, interaction and accessibility. Its own package and its own timeline. |
| Spreadsheet and formula engine | A formula parser, evaluator, dependency graph and recalculation order — a product, not a component. |
| Scheduler / event calendar | Recurrence, timezones, overlap layout and drag-resize are each their own problem. |
| Gantt / project timeline | Dependency graphs and critical-path layout. |
| Kanban board | Once drag-and-drop exists in V1, this becomes ordinary composition. |
| File manager | |
| PDF viewer and annotator | Needs a PDF rendering engine. |
| Maps and geospatial | Needs a tile and projection engine. |
| Code editor | Needs its own text engine, distinct from the rich text editor's. |
| Diagram / node canvas | |

## Charts and gauges

- **Charts / data visualization** — The roadmap has no charting of any kind, yet the 'dashboard' page template it promises needs one. It is the single largest absent category in the survey (area, bar, line, composite, scatter, bubble, pie, donut, radar, radial bar, funnel, gauge, treemap, sunburst, sankey, bullet, heatmap, sparkline). At minimum a sparkline is needed for grid cells and stat tiles; if full charts are in scope it is a package-sized commitment like @voltjs/grid, and if they are not, the roadmap should say so.
- **Charts and gauges (a charting package)** — The roadmap has no charting of any kind — not a single series type, axis, legend or gauge — yet almost every production application has a dashboard. This is the largest completely uncovered area in part 2: roughly 70 survey entries (Chart, Pie/Donut, Funnel, Polar/Radar, Stock, Range Selector, Bullet, Heat Map, 3D, Circular/Linear/Arc/Bar/Digital gauges, Area, Streamgraph, Waterfall, Histogram, Pareto, Sunburst, Icicle, Scatter, Bubble, Beeswarm, Calendar Heatmap, Chord, Arc, Network Graph, Dendrogram, Venn, Word Cloud, Timeline Chart, Candlestick, Box Plot, Violin, Error Bars, Parallel Coordinates, Marimekko, Lollipop, Slope, Bump, KPI Stat Tile, Small Multiples, Combination, Contour, Ternary, Radial Bar, Bar Race, Pictorial Bar, plus Axis/Legend/Tooltip/Crosshair/Annotations/Data Zoom/Export/Drilldown infrastructure) map to nothing planned.

## Enterprise surfaces

- **Scheduler / event calendar** — The inventory's 'calendar' is the date-picker grid — it sits beside date picker and is elaborated only under the Date and time flagship. An event calendar with day/week/month views, positioned events, drag to create and resize to change duration is a different and much larger product. It is the third enterprise surface after the grid and the editor, and the roadmap should claim or exclude it explicitly, because 'calendar' currently reads as though it might be covered.
- **Gantt / project timeline** — Nothing in the roadmap covers task scheduling. The survey devotes ~20 entries to it (Task Tree Grid, Dependency Link Layer, Critical Path, Baselines, Scheduling Engine, Working Time Calendar, Resource Assignment, Utilization View, Leveling, WBS, Split Tasks, Rollups, Progress Line, Earned Value, Project Import/Export, Portfolio View). It reuses the grid's tree data and the scheduler's time axis, so the architectural dependency is worth recording even if it is deferred.
- **Kanban board** — A board is one of the three or four layouts every product application eventually needs, and it is absent. It is also the clearest consumer of the drag-and-drop primitive listed separately below.
- **Spreadsheet and formula engine** — The data grid roadmap covers editing, fill handle, clipboard and undo, but stops short of the spreadsheet layer the survey describes (FormulaEngine, MergedCells, CellBorderEditor, CellComment, ColumnSummaryRow, TrailingAddRow, Excel/Spreadsheet Viewer). Formulas cannot be bolted onto a grid afterwards — they need a dependency graph and reference-translating copy/paste designed in.
- **File manager / file browser** — A dozen survey entries describe it (File Manager, File Picker Dialog, File Preview Viewer, File Properties Pane, Sharing Dialog, Permissions ACL Editor, File Version History, Trash, Storage Quota, File Conflict Dialog, Archive Action, Transfer Queue Panel). The roadmap has `file upload` only. The picker dialog and preview viewer in particular are needed by any application that stores documents.

## Media

- **PDF viewer and annotator** — Appears twice in the survey (PDF Viewer, PDF Viewer & Annotator) and is a standard part of every enterprise suite. The roadmap has no document viewing at all, and it is the natural companion to file upload and any file manager.
- **Maps and geospatial layer** — Around 40 survey entries cover mapping (Map Canvas, Marker, Marker Cluster, Popup, Vector Shape/GeoJSON layers, Layer List, Basemap Gallery, Navigation Controls, Geocoder, Draw & Edit toolbar, Measure, Heatmap layer, Choropleth, Legend, Directions, Isochrone, Time Slider, 3D Terrain, deck.gl overlays, Street View, Overview Map, Coordinate Readout, Graticule, Swipe Compare, Elevation Profile, Feature Info Popup, Feature Attribute Form, Feature Table, Bookmarks, OGC layers, Style Editor, Viewshed, Daylight, Building Explorer, Geofence Editor) plus Vector Map / Tile Map / Geo Chart. Nothing is planned. This may legitimately be out of scope for v1 — but if so it should be an explicit exclusion rather than an omission, because a choropleth is usually expected alongside charts.

## Collaborative editing

Deferred from the rich text editor. The V1 document model is built
operation-based — immutable documents plus explicit steps — for reasons that
stand on their own: undo becomes inverting steps, schema validation happens
before a step is applied, and an IME composition is one atomic change.

Because of that, collaboration here is adding a rebase function rather than
rewriting the model. Deferring it is safe; deferring the model's shape would
not have been.
