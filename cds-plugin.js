/**
 * CDS Plugin — cap-handler-framework
 *
 * Provides automatic handler index file generation.
 *
 * ─── What this plugin does ──────────────────────────────────────────────────
 *
 *  1. On `cds.on('served', ...)`: scans every srv/<service>/handlers/ directory
 *     and generates (or updates) an `index.ts` file listing all handler classes.
 *
 *  2. Safe write: compares new content to the existing file before writing.
 *     If content is identical (ignoring the timestamp), no file is written →
 *     no unnecessary cds watch reload is triggered.
 *
 *  3. File watcher: sets up a directory watcher on the srv/ tree.
 *     When a *Handler.ts or *Handler.js file is added or deleted the index
 *     is regenerated automatically — without requiring a manual server restart.
 *     The watcher is set up ONCE (module-level guard) to survive hot-reloads.
 *
 * ─── Reload loop prevention ─────────────────────────────────────────────────
 *
 *  Without safe write, every bootstrap would rewrite index.ts (because the
 *  timestamp changed), causing cds watch to detect a file change and reload
 *  infinitely.
 *
 *  With safe write:
 *    start → write (new content) → reload → same content → NO write → stable ✅
 *
 * ─── Lifecycle event choice ─────────────────────────────────────────────────
 *
 *  `cds.on('served', ...)` fires after all services are mounted on every
 *  start / hot-reload, making it more reliable than `bootstrap` for index
 *  regeneration.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Module-level state (survives hot-reloads within the same process) ────────
let watcherInitialized = false;

// ── Plugin entry point ───────────────────────────────────────────────────────
module.exports = function () {
  const cds = require('@sap/cds');
  const LOG = cds.log('cap-handler-framework');

  LOG.debug('cap-handler-framework plugin loaded');

  // Regenerate index files on every server start / hot-reload
  cds.on('served', async () => {
    try {
      await autoGenerateHandlerIndices(LOG);
    } catch (err) {
      LOG.warn('Failed to auto-generate handler indices:', err.message);
    }

    // Set up the filesystem watcher once per process lifetime
    if (!watcherInitialized) {
      watcherInitialized = true;
      setupHandlerWatcher(LOG);
    }
  });
};

// ── Index generation ─────────────────────────────────────────────────────────

/**
 * Scan all srv/<service>/handlers/ directories and generate index files.
 */
async function autoGenerateHandlerIndices(LOG) {
  const cds    = require('@sap/cds');
  const srvDir = path.join(cds.root, 'srv');

  if (!fs.existsSync(srvDir)) {
    LOG.debug('No srv/ directory found — skipping handler index generation');
    return;
  }

  const entries = fs.readdirSync(srvDir);
  let writtenCount = 0;

  for (const entry of entries) {
    const serviceDir  = path.join(srvDir, entry);
    if (!fs.statSync(serviceDir).isDirectory()) continue;

    const handlersDir = path.join(serviceDir, 'handlers');
    if (!fs.existsSync(handlersDir)) continue;

    const written = generateHandlerIndex(handlersDir, entry, LOG);
    if (written) {
      LOG.info(`✅  Generated handlers/index.ts for service: ${entry}`);
      writtenCount++;
    }
  }

  if (writtenCount > 0) {
    LOG.info(`Generated ${writtenCount} handler index file(s)`);
  } else {
    LOG.debug('All handler index files are up to date');
  }
}

/**
 * Generate (or update) the index.ts for one service's handlers/ directory.
 *
 * @param {string} handlersDir  - Absolute path to the handlers/ directory
 * @param {string} serviceName  - e.g. "opportunity-management"
 * @param {object} LOG          - CDS logger
 * @returns {boolean}           - true if a new file was written
 */
function generateHandlerIndex(handlersDir, serviceName, LOG) {
  const entitiesDir = path.join(handlersDir, 'entities');
  const proxiesDir  = path.join(handlersDir, 'proxies');

  const entities = scanHandlerFiles(entitiesDir);
  const proxies  = scanHandlerFiles(proxiesDir);

  if (entities.length === 0 && proxies.length === 0) {
    LOG.debug(`No handlers found in ${serviceName}/handlers — skipping`);
    return false;
  }

  const content  = buildIndexContent(serviceName, entities, proxies);
  const filePath = path.join(handlersDir, 'index.ts');

  return safeWriteFile(filePath, content, LOG);
}

/**
 * Return a sorted array of handler base-names (without extension) from a directory.
 * Returns [] if the directory does not exist.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function scanHandlerFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter(f => f.endsWith('Handler.ts') || f.endsWith('Handler.js'))
    .map(f => f.replace(/\.(ts|js)$/, ''))
    .sort();
}

/**
 * Build the string content for an index.ts file.
 *
 * @param {string}   serviceName
 * @param {string[]} entities
 * @param {string[]} proxies
 * @returns {string}
 */
function buildIndexContent(serviceName, entities, proxies) {
  const total = entities.length + proxies.length;
  const lines = [
    '/**',
    ' * AUTO-GENERATED by cap-handler-framework',
    ' *',
    ' * This file is automatically generated.',
    ' * DO NOT EDIT MANUALLY — your changes will be overwritten.',
    ' *',
    ' * To add a new handler:',
    ' *   1. Create YourEntityHandler.ts in entities/ or proxies/',
    ' *   2. The server will regenerate this file automatically.',
    ' *',
    ` * Service  : ${serviceName}`,
    ` * Handlers : ${total} total (${entities.length} entities, ${proxies.length} proxies)`,
    ' */',
    '',
  ];

  if (entities.length > 0) {
    lines.push('// Entity Handlers');
    entities.forEach(name => lines.push(`import ${name} from './entities/${name}';`));
    lines.push('');
  }

  if (proxies.length > 0) {
    lines.push('// Proxy Handlers');
    proxies.forEach(name => lines.push(`import ${name} from './proxies/${name}';`));
    lines.push('');
  }

  lines.push('/**');
  lines.push(' * All handler classes for this service.');
  lines.push(' * The HandlerRegistry instantiates and registers each one.');
  lines.push(' */');
  lines.push('export const HANDLER_CLASSES = [');

  if (entities.length > 0) {
    lines.push(`  // Entity handlers (${entities.length})`);
    entities.forEach(name => lines.push(`  ${name},`));
    if (proxies.length > 0) lines.push('');
  }

  if (proxies.length > 0) {
    lines.push(`  // Proxy handlers (${proxies.length})`);
    proxies.forEach(name => lines.push(`  ${name},`));
  }

  lines.push('];', '');

  return lines.join('\n');
}

// ── Safe write ───────────────────────────────────────────────────────────────

/**
 * Write content to a file ONLY if the normalised content has changed.
 *
 * "Normalised" means stripping the timestamp line so that a re-run without
 * any real changes does not trigger an unnecessary cds watch reload.
 *
 * @param {string} filePath
 * @param {string} newContent
 * @param {object} LOG
 * @returns {boolean} true if the file was written
 */
function safeWriteFile(filePath, newContent, LOG) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (normalise(existing) === normalise(newContent)) {
      LOG.debug(`No change — skipping write for ${path.basename(filePath)} in ${path.dirname(filePath)}`);
      return false;
    }
  }

  fs.writeFileSync(filePath, newContent, 'utf8');
  return true;
}

/**
 * Strip volatile lines (timestamps) before comparing content.
 * Keeps the comparison stable across runs so the same logical content
 * never triggers an unnecessary file write.
 *
 * @param {string} content
 * @returns {string}
 */
function normalise(content) {
  return content
    // Remove any line containing only a timestamp comment
    .replace(/^ \* Generated\s*:.+$/gm, '')
    .trim();
}

// ── File watcher ─────────────────────────────────────────────────────────────

/**
 * Set up a watcher on srv/ that regenerates index files when *Handler.ts/js
 * files are added or removed.
 *
 * Strategy (in preference order):
 *  1. chokidar   — preferred; CDS ships it as a transitive dependency
 *  2. fs.watch   — Node.js built-in fallback (less reliable on some platforms)
 *
 * The watcher is intentionally NON-persistent so it does not keep the process
 * alive after cds watch exits.
 *
 * @param {object} LOG
 */
function setupHandlerWatcher(LOG) {
  const cds    = require('@sap/cds');
  const srvDir = path.join(cds.root, 'srv');

  if (!fs.existsSync(srvDir)) return;

  const onChange = debounce(async () => {
    try {
      await autoGenerateHandlerIndices(LOG);
    } catch (err) {
      LOG.warn('Handler watcher regeneration failed:', err.message);
    }
  }, 200);

  // ── Try chokidar first ──────────────────────────────────────────────────
  try {
    const chokidar = require('chokidar');
    const pattern  = path.join(srvDir, '*', 'handlers', '**', '*Handler.{ts,js}');

    const watcher = chokidar.watch(pattern, {
      ignoreInitial : true,
      persistent    : false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher
      .on('add',    f => { LOG.debug(`Handler added: ${f}`);   onChange(); })
      .on('unlink', f => { LOG.debug(`Handler removed: ${f}`); onChange(); });

    LOG.info('Handler file watcher started (chokidar)');
    return;
  } catch (_) {
    // chokidar not available — fall through to fs.watch
  }

  // ── Fallback: native fs.watch ───────────────────────────────────────────
  try {
    fs.watch(srvDir, { recursive: true, persistent: false }, (eventType, filename) => {
      if (!filename) return;
      if (
        (filename.endsWith('Handler.ts') || filename.endsWith('Handler.js')) &&
        !filename.includes('index')
      ) {
        LOG.debug(`fs.watch detected change: ${filename}`);
        onChange();
      }
    });
    LOG.info('Handler file watcher started (fs.watch fallback)');
  } catch (err) {
    LOG.warn('Could not start handler file watcher:', err.message);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Simple debounce — prevents multiple rapid file changes from triggering
 * multiple regeneration runs.
 *
 * @param {Function} fn
 * @param {number}   ms
 * @returns {Function}
 */
function debounce(fn, ms) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}
