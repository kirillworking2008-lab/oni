declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): {
    buffer: ArrayBuffer;
    byteOffset: number;
    byteLength: number;
  };
}
