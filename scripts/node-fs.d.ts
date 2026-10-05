// Minimal typing for the Node fs calls used by server scripts (@types/node is not a dependency).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string): void;
}
