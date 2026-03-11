/**
 * CDS Plugin Integration (CDS 9 compatible)
 * 
 * This allows the framework to be registered as a CDS plugin.
 * The framework is passive - handlers are explicitly registered via registerHandlers()
 * This file mainly serves to mark the package as a CDS plugin
 */

// CDS 9 expects a simple module export
module.exports = function() {
  // Plugin is passive - no automatic registration
  // Handlers are explicitly registered via registerHandlers() in service files
  const cds = require('@sap/cds');
  cds.log('cap-handler-framework').debug('CAP Handler framework plugin loaded');
};
