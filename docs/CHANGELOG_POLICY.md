# Changelog Policy

## Versioning

This repository follows Semantic Versioning:

- `MAJOR`: breaking API/behavior changes
- `MINOR`: additive features and backward-compatible enhancements
- `PATCH`: backward-compatible fixes

## What Must Be Logged

Every release entry in `CHANGELOG.md` includes:

- Added
- Changed
- Fixed
- Security (if applicable)
- Migration notes (if applicable)

## Entry Requirements

Each item should include:

- User-visible impact
- Affected API/function/type
- Upgrade action (if required)

## Breaking Change Rules

Breaking changes require:

- Major version bump
- Explicit migration section
- At least one code example showing before/after usage

## Release Automation

- Changesets drive release PR generation and version bumps.
- `release.yml` publishes to npm from main after checks.
- Non-main runs are dry-run only.
