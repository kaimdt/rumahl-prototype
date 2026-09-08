# rumahl Git Hooks

This directory contains git hooks for the rumahl project.

## Setup

Run once to activate hooks:

```bash
git config core.hooksPath .githooks
```

## Available Hooks

- **pre-commit**: Runs `cargo check` before each commit
  - Skip with: `git commit --no-verify`
