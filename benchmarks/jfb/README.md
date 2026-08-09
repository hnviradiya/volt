# js-framework-benchmark implementation

The Volt entry for the official
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark),
keyed category.

It is structured to mirror the Solid implementation as closely as the two
frameworks allow, so a comparison reflects the frameworks rather than two
authors' choices:

- each row owns a `label` signal, so "update every 10th row" writes 100
  signals and touches 100 text nodes, never the list
- rows are keyed by id, so swap and remove move existing elements
- the row id is captured as a plain value, exactly as Solid does

## Building

The bundle is built here rather than inside the benchmark checkout, because
the Volt plugin's own dependencies resolve through this workspace's pnpm
tree:

```bash
pnpm exec vite build --config benchmarks/jfb/vite.config.ts
```

Then copy `dist/main.js` into the harness at
`frameworks/keyed/volt/dist/main.js`, alongside an `index.html` and a
`package.json` carrying the `js-framework-benchmark` metadata block.

## Running the official harness

```bash
git clone --depth 1 https://github.com/krausest/js-framework-benchmark
cd js-framework-benchmark
npm run install-local
cd server && npm start &

cd webdriver-ts
node dist/isKeyed.js --headless true --chromeBinary $(which google-chrome) keyed/volt
node dist/benchmarkRunner.js --headless true --chromeBinary $(which google-chrome) \
  --framework keyed/volt keyed/solid keyed/vanillajs --count 10
```

`--chromeBinary` matters on Linux: the harness defaults to
`/snap/bin/chromium`, and chromedriver's major version must match the
installed Chrome.
