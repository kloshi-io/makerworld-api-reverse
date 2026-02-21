# Contributing

Thanks for contributing to `makerworld-api-reverse`.

## Scope

We accept contributions for:

- Parser resilience and payload compatibility
- Test coverage and fixtures
- Documentation clarity
- Typed API improvements that preserve backward compatibility

## Development Setup

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Local Validation Before PR

Run:

```bash
npm run typecheck
npm test
npm run test:docs
npm run test:examples
npm run pack:check
```

## Branch + PR Workflow

1. Open or reference an issue first when possible.
2. Keep PR scope focused.
3. Add or update tests for behavior changes.
4. Update docs for public API changes.
5. Fill out the PR template completely.

## Commit Guidelines

- Use clear, neutral commit messages.
- Preferred format: `<type>: <short summary>`
- Examples:
  - `docs: add API reference and troubleshooting manual`
  - `feat: add optional request headers for resolver`
  - `fix: handle malformed fallback payloads safely`

## Good First Issue Checklist

- Confirm reproduction steps.
- Add failing test first.
- Implement focused fix.
- Validate with full local command set.
- Link issue in PR description.

## Backward Compatibility Policy

- Additive changes only in minor versions.
- Breaking changes require major version bump and migration notes.

## Security

Please do not disclose vulnerabilities publicly first. See `SECURITY.md`.
