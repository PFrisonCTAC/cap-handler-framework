/**
 * @ctac/cap-handler-framework
 * 
 * Handler framework for SAP CAP applications with multi-service support
 */

// ===========================
// Core Classes
// ===========================
export { BaseHandler } from './core/BaseHandler';
export { ProxyHandler } from './core/ProxyHandler';
export { registerHandlers } from './core/HandlerRegistry';
export { createHandlerContext, HandlerContextBuilder } from './core/HandlerContext';

// ===========================
// Utilities
// ===========================
export { ExpandTree } from './utils/ExpandTree';
export { VirtualElementFilter } from './utils/VirtualElementFilter';

// ===========================
// Type Exports
// ===========================
export type {
  HandlerContext,
  TypedRequest,
  ExpandConfig,
  DeepCopyOptions,
  Logger,
  CAPEvent,
  EventPhase,
} from './core/types';
