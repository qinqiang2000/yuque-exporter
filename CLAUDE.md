# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

yuque-exporter is a CLI tool that exports Yuque (语雀) documentation to local Markdown files. It handles batch exports, preserves directory structure, downloads images, converts internal links to relative paths, and supports incremental updates.

## Development Commands

### Build and Run
```bash
# Development mode (requires YUQUE_TOKEN)
YUQUE_TOKEN=xxx npm run start:dev

# Build TypeScript to dist/
npm run build

# Production mode
node dist/main.js

# CLI tool (after build)
YUQUE_TOKEN=xxx node dist/bin/cli.js [repos...]
```

### Testing
```bash
# Run all tests
npm test

# Run tests with coverage
npm run cov
```

### Code Quality
```bash
# Lint
npm run lint

# Fix linting issues
npm run lint:fix
```

## Architecture

### Two-Phase Export Process

The tool operates in two distinct phases:

1. **Crawl Phase** (`src/lib/crawler.ts`)
   - Fetches metadata from Yuque API using the SDK (`src/lib/sdk.ts`)
   - Retrieves user info, repositories, TOC (Table of Contents), and document lists
   - Downloads individual document details using a task queue (concurrency: 10)
   - Stores all metadata as JSON in `./storage/.meta/`
   - Implements incremental updates by comparing `published_at` timestamps

2. **Build Phase** (`src/lib/builder.ts`)
   - Reads cached metadata from `.meta/` directory
   - Converts TOC structure to a tree using `src/lib/tree.ts`
   - Processes each document via `src/lib/doc.ts`
   - Downloads images and converts links to relative paths
   - Outputs final Markdown files to `./storage/`

### Key Modules

**`src/lib/sdk.ts`** - Yuque API wrapper
- Handles authentication with `X-Auth-Token` header
- Implements pagination for `getDocs()` (limit: 100 per page)
- Returns typed responses for User, Repo, Doc, and DocDetail

**`src/lib/tree.ts`** - Tree structure builder
- Converts flat TOC list to hierarchical tree using `performant-array-to-tree`
- Handles duplicate file names by appending numeric suffixes
- Creates `_未分类文档` folder for draft documents not in TOC
- Calculates final file paths for each node

**`src/lib/doc.ts`** - Document processor
- Supports multiple formats: regular markdown, lake format, and lakesheet (tables)
- Uses `remark` plugins to transform markdown:
  - `replaceHTML`: Converts `<br/>` to newlines
  - `relativeLink`: Transforms Yuque URLs to relative paths
  - `downloadAsset`: Downloads images to `assets/` folder
- Adds YAML frontmatter with title and URL
- Skips processing if `published_at` unchanged and markdown file exists

**`src/config.ts`** - Global configuration
- Reads `YUQUE_TOKEN` from environment variable
- Default output: `./storage`, metadata: `./storage/.meta`
- Configurable via CLI flags: `--token`, `--host`, `-o`/`--output`, `--repo`, `--clean`
- `--repo` allows customizing the output folder name instead of using the repo name

### CLI Usage Patterns

The CLI (`src/bin/cli.ts`) supports three modes:

```bash
# Default: crawl + build
node dist/bin/cli.js user/repo

# Crawl only
node dist/bin/cli.js crawl user/repo

# Build only (requires prior crawl)
node dist/bin/cli.js build

# Custom output directory and repo folder name
node dist/bin/cli.js user/repo -o /path/to/output --repo custom-name

# Example with YUQUE_TOKEN environment variable
YUQUE_TOKEN=xxx node dist/bin/cli.js nbklz3/pgrkef --clean -o /Users/qinqiang02/colab/office/ai-knowledge-base/data/kb --repo my-knowledge-base
```

Input patterns:
- `user` - exports all repos for the user
- `user/repo` - exports specific repo
- Multiple repos: `user/repo1 user/repo2`

CLI Options:
- `-o, --output` - Output target directory (default: `./storage`)
- `--repo` - Custom repo directory name (default: uses repo name from Yuque)
- `--clean` - Clean the output directory before exporting
- `--token` - Yuque API token (can also use `YUQUE_TOKEN` env var)
- `--host` - Yuque host (default: `https://www.yuque.com`)

### Incremental Updates

The tool tracks document freshness using:
- `docs-published-at.json` maps `doc.id -> published_at` timestamp
- During crawl: only fetches documents where `published_at` changed
- During build: skips markdown generation if timestamp unchanged AND file exists

### ESM Module Setup

This is a pure ESM project (not CommonJS):
- `package.json` has `"type": "module"`
- All imports use `.js` extensions (required for ESM)
- TypeScript compiles `.ts` to `.js` while preserving ESM format
- Use `ts-node-esm` for development mode
- Main entry: `src/main.ts`, CLI entry: `src/bin/cli.ts`

## Common Development Patterns

### Running Tests
```bash
# Single test file
npm test -- test/builder.test.ts

# With grep pattern
npm test -- --grep "pattern"
```

### Adding New Document Formats
When supporting new Yuque formats (like lakesheet tables), modify `src/lib/doc.ts`:
1. Check `docDetail.format` field
2. Extract content from appropriate `body_*` field
3. Convert to markdown format
4. Add to the remark processing pipeline

### Debugging API Calls
The SDK in `src/lib/sdk.ts` logs errors with full response. To see requests:
- Check console output for API errors
- API rate limit: 5000 requests/hour
- Base URL: `https://www.yuque.com/api/v2/`

## Important Notes

- Token required: Get from https://www.yuque.com/settings/tokens
- Attachments currently skip download (require authentication)
- Duplicate titles get numeric suffixes (`_1`, `_2`, etc.)
- Draft documents placed in `_未分类文档/` folder
- Share links (`/docs/share/`) are auto-redirected to actual URLs
- Build copies `src/bin/help.md` to `dist/bin/help.md`
