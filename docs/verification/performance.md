# PERF-01 browser benchmark

Run from the repository root with the pinned Node 24.22.3, pnpm 11.25.0 and
Playwright 1.64.0. Install the locked dependencies and the Playwright Chromium
browser first. Set `PLAYWRIGHT_BROWSERS_PATH` only when using a nondefault
browser install. Use the 4185 loopback port with no other server listening
and build without production backend variables.

```sh
pnpm install --frozen-lockfile
perf_scratch="$(mktemp -d "${TMPDIR:-/tmp}/moja-s5-performance.XXXXXX")"
export MOJA_S5_PERF_BUILD="$perf_scratch/child-dist"
export PLAYWRIGHT_JSON_OUTPUT_FILE="$perf_scratch/results.json"
CI=1 pnpm --filter @moja-nauka/child build --outDir "$MOJA_S5_PERF_BUILD"
CI=1 pnpm exec playwright test -c tests/s5/performance.config.ts \
  --reporter=list,json --output "$perf_scratch/playwright-output"
```

The production-built child shell runs in a fresh Playwright Chromium context
for each workload. The tablet profile is Galaxy Tab S4 emulation on the
desktop host. A local route supplies the full catalog and the 333,033-byte
original fixture under 100 distinct lesson and version IDs. The test reuses
one source fixture Buffer and delays each successful body response by 20 ms
to expose overlap between the application's download workers. The 1,000-item
catalog contains valid metadata only. Its grant stub does not serve bodies.
Both workloads revisit Home with Chromium offline and require the navigation
response to come from the Service Worker.

Timing marks use the browser's monotonic clock. Cold and offline Home timings
begin at navigation. First and complete install timings begin at pairing form
submission and end at the respective truthful availability display. Catalog
render time ends when all expected rows appear in the DOM. Presentation time
waits two animation frame callbacks. Scrolling advances through the full subject
list in 60 frame callbacks and reports the frame interval distribution. The
opaque lesson frame records its own first active-slide presentation opportunity
and first decoded embedded JPEG. Click-to-frame measurements subtract absolute
browser performance timestamps.

Storage proof walks IndexedDB lesson keys and independently rehashes each
stored Blob in sequence outside the measured timing interval. The browser's
origin storage numbers are estimates. Renderer heap snapshots use Chromium CDP
before opening the viewer and once it mounts. No GC is forced. Page snapshots
include whichever frames share the page renderer. A separate inner frame sample
is recorded only if Chromium exposes a separate target. These samples do not
measure process RSS, isolated frame images, GPU memory, or a high-water mark.
The observations apply to local loopback, the measured desktop host and virtual
profiles. Physical Android performance, hosted network throughput and Apple
compatibility remain outside this evidence.
