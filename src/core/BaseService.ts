/**
 * @module cap-handler-framework
 * BaseService — singleton service layer for CDS service access
 *
 * Usage:
 *   class MyService extends DBService { ... }
 *   const svc = await BaseService.getInstance(MyService);
 */

// ─── @sap/cds peer dependency ────────────────────────────────────────────────
// Resolve from the consuming project so the framework shares the same cds
// instance as the host CAP application (prevents dual-cds instance error).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const cds = require(require.resolve('@sap/cds', { paths: [process.cwd()] }));
// ─────────────────────────────────────────────────────────────────────────────

export abstract class BaseService {
  private static readonly _instances = new Map<string, BaseService>();
  private static readonly _cdsServices = new Map<string, any>();

  protected readonly serviceName: string;
  protected cdsService!: any;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  public async connect(): Promise<any> {
    if (BaseService._cdsServices.has(this.serviceName)) {
      this.cdsService = BaseService._cdsServices.get(this.serviceName);
    } else {
      this.cdsService = await cds.connect.to(this.serviceName);
      BaseService._cdsServices.set(this.serviceName, this.cdsService);
    }
    return this.cdsService;
  }

  public getService(): any {
    return this.cdsService;
  }

  public static async getInstance<T extends BaseService>(
    ServiceClass: new () => T
  ): Promise<T> {
    const key = ServiceClass.name;
    if (BaseService._instances.has(key)) {
      return BaseService._instances.get(key) as T;
    }
    const instance = new ServiceClass();
    BaseService._instances.set(key, instance);
    await instance.connect();
    return instance as T;
  }

  public static async getInstances<T extends BaseService>(
    serviceClasses: Array<new () => T>
  ): Promise<T[]> {
    return Promise.all(serviceClasses.map(sc => BaseService.getInstance(sc)));
  }

  /** Clear all cached instances — use in test teardown or after hot-reload */
  public static reset(): void {
    BaseService._instances.clear();
    BaseService._cdsServices.clear();
  }
}
