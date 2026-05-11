# Evaluation Protocol

This document defines an evidence-safe evaluation plan for FloraPulse. It is intentionally written as a protocol, not as a results section. No therapeutic effect, latency target, or user-study outcome should be claimed until measured.

## 1. Technical Benchmark

The repository includes a local benchmark runner:

```bash
node scripts/run-benchmark.mjs
```

It opens `index.html?demo=1&benchmark=1` in Chrome headless through the Chrome DevTools Protocol and writes machine-specific metrics to `benchmarks/results/latest.json`.

### Metrics

| Metric | Method | Output |
|---|---|---|
| Startup time | Measure from page load to default image target readiness | milliseconds |
| Image sampling time | Measure `processImage()` duration for fixed image sizes | milliseconds |
| Render performance | Record FPS under 10k, 30k, and 50k particles | mean, median, p95 FPS |
| Interaction latency | Measure delay from hand landmark callback to shader uniform update | milliseconds |
| Audio trigger interval | Log generated note events and interval distribution | events/minute |
| Memory stability | Monitor browser memory during a 10-minute session | MB and trend |

### Reporting Rule

Report hardware, browser version, operating system, particle count, viewport size, and whether WebGL uses hardware acceleration or SwiftShader. Do not compare against other systems unless the benchmark setup is identical and reproducible.

## 2. User Experience Study Plan

### Study Status

Not yet conducted. Any paper draft must describe this as a planned or future study unless real data are collected.

### Participants

Recruit adult participants who can safely use visual and audio interactive media. Exclude participants who report photosensitive epilepsy risk or discomfort with camera-based interaction. If minors are included, obtain guardian consent and follow institutional ethics requirements.

### Procedure

1. Pre-session briefing and consent.
2. Baseline self-report of mood, stress, or affect using validated instruments selected before the study.
3. 5-10 minute FloraPulse interaction session.
4. Post-session self-report and short semi-structured interview.
5. Optional qualitative coding of perceived calmness, agency, natural connectedness, and interaction clarity.

### Safety

FloraPulse is not a medical device and should not be presented as treatment. Participants should be free to stop at any time. Camera input should be processed locally in the browser whenever possible.

## 3. Paper Reporting Boundary

Allowed before user study:

- System architecture.
- Implementation details.
- Design rationale.
- Technical benchmark results if measured.
- Evaluation protocol.
- Limitations.

Not allowed before user study:

- Claims that the system reduces anxiety.
- Claims that users experienced significant stress relief.
- Claims about clinical effectiveness.
- Fabricated sample size, p-values, questionnaire means, or interview themes.
