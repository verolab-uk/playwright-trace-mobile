# Playwright Trace Mobile

A mobile-friendly build of the [Playwright](https://github.com/microsoft/playwright) trace viewer. Apache-2.0, like Playwright; keep `LICENSE` and `NOTICE`.

## Using it in a Playwright report

After `npx playwright test` creates `playwright-report`, replace the report's trace viewer. Trace links in the report then open the mobile viewer:

```yaml
- uses: verolab-uk/playwright-trace-mobile/.github/actions/install-report-viewer@main
  with:
    report-dir: playwright-report
```

To make traces smaller, compact them before publishing the report. Compaction keeps only screencast frames near actions or with visible changes:

```yaml
- uses: verolab-uk/playwright-trace-mobile/.github/actions/compact-traces@main
  with:
    paths: test-results playwright-report
```

## Development

```bash
npm ci
npm run typecheck
npm run build                       # outputs dist/
npx playwright install chromium
npm test                            # records a trace, opens it in dist/ at phone size
```

On every push, CI posts phone screenshots of the viewer on the branch's PR (`npm test` writes them to `screenshots/`).

Mobile changes live in `packages/trace-viewer`. The other `packages/` directories are upstream sources the viewer builds from.

Compact-traces action tests: `cd .github/actions/compact-traces && bun install && bun run test`.

## Upgrading Playwright

`UPSTREAM` records the Playwright version. Run `npm run sync-upstream -- v1.64.0`: it merges the upstream changes into `packages/` and lists files with conflicts against the mobile changes. Resolve them, `npm install`, then typecheck, build and test. If the build fails on a missing module, add its upstream path to `scripts/sync-upstream.sh` and copy that file from upstream.
