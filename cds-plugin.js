/**
 * CAP Handler Framework - CDS Plugin
 * 
 * Auto-discovers and registers handlers for all CAP services.
 * 
 * Convention:
 * - Service: OpportunityManagementService
 * - Folder: srv/opportunity-management/handlers/
 * - Config: srv/opportunity-management/handlers.config.json (optional)
 */

const cds = require('@sap/cds');
const path = require('path');
const fs = require('fs');

module.exports = cds.plugin('cap-handler-framework', {
  async init() {
    console.log('[CAP Handler Framework] Initializing...');
    
    // Register handlers when services are served
    cds.on('served', async (services) => {
      for (const srv of services) {
        await autoRegisterHandlers(srv);
      }
    });
  }
});

/**
 * Auto-register handlers for a service
 */
async function autoRegisterHandlers(srv) {
  try {
    const serviceName = srv.name;
    
    // Convert service name to folder name
    // OpportunityManagementService → opportunity-management
    const servicePath = toKebabCase(serviceName);
    const handlersPath = path.join(cds.root, 'srv', servicePath, 'handlers');
    
    // Check if handlers folder exists
    if (!fs.existsSync(handlersPath)) {
      console.log(`[CAP Handler Framework] No handlers found for ${serviceName}`);
      return;
    }
    
    // Load optional configuration
    const configPath = path.join(cds.root, 'srv', servicePath, 'handlers.config.json');
    const config = fs.existsSync(configPath) 
      ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
      : {};
    
    console.log(`[CAP Handler Framework] Registering handlers for ${serviceName}...`);
    
    // Import registration function
    const { registerHandlers } = require('./core/HandlerRegistry');
    
    // Load utilities
    const utilities = await loadUtilities(config.utilities || {}, servicePath);
    
    // Register handlers with auto-discovery
    await registerHandlers(srv, {
      baseDir: handlersPath,
      externalServices: config.externalServices || [],
      utilities: utilities,
      config: config.config || {},
    });
    
    console.log(`[CAP Handler Framework] ✓ Handlers registered for ${serviceName}`);
    
  } catch (error) {
    console.error(`[CAP Handler Framework] Failed to register handlers for ${srv.name}:`, error);
  }
}

/**
 * Convert service name to kebab-case folder name
 * 
 * Examples:
 * - OpportunityManagementService → opportunity-management
 * - ValueHelpService → value-help
 * - CatalogService → catalog
 */
function toKebabCase(str) {
  return str
    .replace(/Service$/, '')           // Remove 'Service' suffix
    .replace(/([a-z])([A-Z])/g, '$1-$2') // Insert hyphen before capitals
    .toLowerCase();
}

/**
 * Load utility instances from config
 * 
 * Config format:
 * {
 *   "utilities": {
 *     "sequenceManager": "./handlers/utils/SequenceManager"
 *   }
 * }
 */
async function loadUtilities(utilitiesConfig, servicePath) {
  const utilities = {};
  
  for (const [name, modulePath] of Object.entries(utilitiesConfig)) {
    try {
      const fullPath = path.join(cds.root, 'srv', servicePath, modulePath);
      
      // Support both .ts and .js
      let resolvedPath = fullPath;
      if (!fs.existsSync(fullPath)) {
        // Try with .ts extension
        if (fs.existsSync(fullPath + '.ts')) {
          resolvedPath = fullPath + '.ts';
        } else if (fs.existsSync(fullPath + '.js')) {
          resolvedPath = fullPath + '.js';
        }
      }
      
      const UtilityModule = require(resolvedPath);
      const UtilityClass = UtilityModule.default || UtilityModule;
      
      // Instantiate utility
      utilities[name] = new UtilityClass();
      
      console.log(`[CAP Handler Framework] Loaded utility: ${name}`);
    } catch (error) {
      console.error(`[CAP Handler Framework] Failed to load utility ${name}:`, error.message);
    }
  }
  
  return utilities;
}

/**
 * Auto-register unbound actions and functions
 */
async function registerOperations(srv, handlersPath) {
  const operationsPath = path.join(handlersPath, 'operations');
  
  if (!fs.existsSync(operationsPath)) {
    return;
  }
  
  const operations = fs.readdirSync(operationsPath);
  
  for (const opFile of operations) {
    if (!opFile.endsWith('.ts') && !opFile.endsWith('.js')) {
      continue;
    }
    
    try {
      const operationName = path.basename(opFile, path.extname(opFile));
      const operationPath = path.join(operationsPath, opFile);
      const handler = require(operationPath).default || require(operationPath);
      
      // Register as action/function
      srv.on(operationName, handler);
      
      console.log(`[CAP Handler Framework] Registered operation: ${operationName}`);
    } catch (error) {
      console.error(`[CAP Handler Framework] Failed to register operation ${opFile}:`, error.message);
    }
  }
}
