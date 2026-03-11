/**
 * Global type declarations for CAP
 */

declare module '@sap/cds' {
  export interface Request {
    data: any;
    params: any[];
    user: { id: string; [key: string]: any };
    query: any;
    error(code: number, message: string): any;
    reject(code: number, message: string): any;
    [key: string]: any;
  }

  export interface ApplicationService {
    name: string;
    before(event: string, entity: any, handler: Function): void;
    on(event: string, entity: any, handler: Function): void;
    after(event: string, entity: any, handler: Function): void;
    before(event: string, handler: Function): void;
    on(event: string, handler: Function): void;
    after(event: string, handler: Function): void;
    [key: string]: any;
  }

  export function log(component?: string): {
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    debug(...args: any[]): void;
    [key: string]: any;
  };

  export const utils: {
    uuid(): string;
    [key: string]: any;
  };

  export function tx(req?: any): any;
  export function connect(options?: any): any;

  const cds: {
    log: typeof log;
    utils: typeof utils;
    tx: typeof tx;
    connect: typeof connect;
    root: string;
    [key: string]: any;
  };

  export default cds;
}

// Global CDS query builders
declare global {
  const SELECT: any;
  const INSERT: any;
  const UPDATE: any;
  const DELETE: any;
  const UPSERT: any;
}

export {};
