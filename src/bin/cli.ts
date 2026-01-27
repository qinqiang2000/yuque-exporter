#!/usr/bin/env node

// TODO: use yargs or artus-common-bin to refactor it

import { parseArgs } from 'util';
import fs from 'fs/promises';

import { config } from '../config.js';
import { build } from '../lib/builder.js';
import { crawl } from '../lib/crawler.js';
import { YuqueExporterError } from '../lib/errors.js';
import { logger } from '../lib/utils.js';

const options = {
  token: {
    type: 'string' as const,
    description: 'yuque token',
  },
  host: {
    type: 'string' as const,
    description: 'yuque host',
    default: 'https://www.yuque.com',
  },
  output: {
    type: 'string' as const,
    description: 'output target directory',
    default: './storage',
    short: 'o',
  },
  repo: {
    type: 'string' as const,
    description: 'custom repo directory name',
  },
  clean: {
    type: 'boolean' as const,
    description: 'Whether clean the output target directory',
    default: false,
  },
  'skip-draft': {
    type: 'boolean' as const,
    description: 'Skip draft and uncategorized documents',
    default: true,
  },
  timeout: {
    type: 'string' as const,
    description: 'Request timeout in milliseconds',
  },
  concurrency: {
    type: 'string' as const,
    description: 'Number of concurrent requests',
    short: 'c',
  },
  'max-retries': {
    type: 'string' as const,
    description: 'Maximum number of retries on failure',
  },
  'retry-delay': {
    type: 'string' as const,
    description: 'Initial delay between retries in milliseconds',
  },
  help: {
    type: 'boolean' as const,
    description: 'Show help',
    short: 'h',
  },
};

const argv = parseArgs({
  options,
  allowPositionals: true,
  args: process.argv.slice(2),
});

if (argv.values.help) {
  const content = await fs.readFile(new URL('./help.md', import.meta.url), 'utf-8');
  console.log(content);
  process.exit(0);
}

console.log(argv);

// set config
const {
  output,
  repo,
  'skip-draft': skipDraft,
  timeout,
  concurrency,
  'max-retries': maxRetries,
  'retry-delay': retryDelay,
  ...restValues
} = argv.values;

Object.assign(config, restValues, {
  outputDir: output || config.outputDir,
  repoDir: repo,
  skipDraft: skipDraft,
  timeout: timeout ? parseInt(timeout, 10) : config.timeout,
  concurrency: concurrency ? parseInt(concurrency, 10) : config.concurrency,
  maxRetries: maxRetries ? parseInt(maxRetries, 10) : config.maxRetries,
  retryDelay: retryDelay ? parseInt(retryDelay, 10) : config.retryDelay,
});

// validate token
if (!config.token) {
  logger.error('Missing YUQUE_TOKEN');
  logger.info('Set it via: export YUQUE_TOKEN=your_token or use --token flag');
  logger.info('Get your token at: https://www.yuque.com/settings/tokens');
  process.exit(1);
}

// execute command
try {
  const [ command, ...repos ] = argv.positionals;
  switch (command) {
    case 'crawl': {
      await crawl(repos, true);  // updateTimestamps = true for standalone mode
      break;
    }

    case 'build': {
      await build();  // No crawl results in build-only mode
      break;
    }

    default: {
      const crawlResults = await crawl(argv.positionals, false);  // Don't update yet
      await build(crawlResults);  // Build will update after success
      break;
    }
  }
} catch (err) {
  if (err instanceof YuqueExporterError) {
    logger.error(err.message);
    if (err.suggestion) {
      logger.info(err.suggestion);
    }
  } else if (err instanceof Error) {
    logger.error(err.message);
  } else {
    logger.error(String(err));
  }
  process.exit(1);
}
