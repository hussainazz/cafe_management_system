declare module "qz-tray" {
  const qz: {
    websocket: { isActive(): boolean; connect(): Promise<void> };
    security: { setCertificatePromise(callback: () => Promise<string>): void; setSignaturePromise(callback: (toSign: string) => Promise<string>): void; setSignatureAlgorithm(algorithm: "SHA512"): void };
    printers: { find(query?: string): Promise<string[] | string> };
    configs: { create(printer: string, options: Record<string, unknown>): unknown };
    print(config: unknown, data: Array<{ type: "pixel"; format: "html"; flavor: "plain"; data: string; options: { pageWidth: number } }>): Promise<void>;
  };
  export default qz;
}
