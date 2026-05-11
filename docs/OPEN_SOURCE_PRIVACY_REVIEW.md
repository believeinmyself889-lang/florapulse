# Open-Source Privacy Review

Date: 2026-05-11

Repository target: https://github.com/believeinmyself889-lang/florapulse

## Release Scope

This public release includes the browser application source code, the default `rice.png` case asset, screenshots, Docker deployment file, benchmark runner, benchmark protocol, and evaluation protocol.

The release intentionally excludes manuscript source files, manuscript PDFs, unpublished submission checklists, private project assessment notes, local benchmark JSON files, original Word documents, LaTeX build artifacts, and the private development Git history.

## Excluded Paths

The following paths were excluded before publication:

| Path or pattern | Reason |
|---|---|
| `paper/` | Manuscript source, references, and generated PDF are not part of the public code release |
| `docs/EI_*.md` | Unpublished paper draft/checklist material |
| `docs/PROJECT_ASSESSMENT_*.md` | Internal project assessment notes and local path references |
| `docs/references.bib` | Paper bibliography, not required for the software artifact |
| `benchmarks/results/*.json` | Machine-specific local benchmark output |
| `*.docx` | Original unpublished planning or thesis-related documents |
| Existing `.git/` history | Prior commits contain paper-related material and should not be published |

## Automated Checks Performed

The release directory was scanned for common secret and privacy patterns, including API keys, access tokens, passwords, private keys, GitHub token prefixes, local user-profile paths, email markers, and paper-related file paths.

The public Git repository was initialized from a fresh directory so that excluded files are not recoverable from Git history.

## Data Handling Notes

FloraPulse is a static browser prototype. It has no backend service, database, authentication system, telemetry pipeline, or remote storage layer. Uploaded images are processed in the browser runtime for particle target generation. Camera access is requested only for browser-side hand tracking, and the repository does not include code for uploading or storing camera frames.

The current prototype loads Three.js and MediaPipe from public CDNs. Users who require stricter offline or institutional deployment should vendor these dependencies locally and review the corresponding third-party privacy policies.

## Publication Decision

The sanitized release is suitable for public open-source publication as a software artifact. It should be cited as an implementation repository and reproducibility package, not as a public release of the full manuscript or unpublished submission materials.
