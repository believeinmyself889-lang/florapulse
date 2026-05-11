# FloraPulse Benchmark

FloraPulse includes a dependency-free benchmark runner that uses Chrome headless and the Chrome DevTools Protocol. It does not require `npm`, Playwright, Puppeteer, or a build step.

## Run

```bash
node scripts/run-benchmark.mjs
```

The script starts a temporary static server, opens `index.html?demo=1&benchmark=1`, waits for the default rice image to be processed, samples frame timing for a short interval, and writes:

```text
benchmarks/results/latest.json
```

## Optional Environment Variables

| Variable | Default | Description |
|---|---:|---|
| `CHROME_PATH` | auto-detect | Absolute path to Chrome or Chromium |
| `FLORAPULSE_BENCHMARK_MS` | `5000` | Frame sampling duration after default image readiness |
| `FLORAPULSE_VIEWPORT` | `1440,900` | Headless browser viewport size |
| `FLORAPULSE_DEBUG_PORT` | `9333` | Chrome DevTools Protocol port |

## Metrics

The benchmark collects:

- seed geometry creation time,
- Three.js readiness time,
- default image load time,
- image sampling time,
- particle assignment time,
- time from app start to default rice readiness,
- measured frame count,
- mean frame time,
- p95 frame time,
- approximate mean FPS,
- accepted image pixels,
- WebGL version and antialias setting.

## Reporting Rule

Benchmark values are machine-specific. Report the browser path, viewport, Node.js version, platform, Git commit, and WebGL backend together with the numbers. Do not use these local metrics as evidence of user experience or therapeutic effect.
