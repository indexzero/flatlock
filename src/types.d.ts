/**
 * Ambient module declarations for packages without types
 */

declare module '@yarnpkg/lockfile' {
  interface ParseResult {
    type: 'success' | 'merge' | 'conflict';
    object: Record<
      string,
      {
        version: string;
        resolved?: string;
        integrity?: string;
      }
    >;
  }

  function parse(content: string): ParseResult;

  interface YarnLockfile {
    parse: typeof parse;
    default?: {
      parse: typeof parse;
    };
  }

  const yarnLockfile: YarnLockfile;
  export = yarnLockfile;
}

declare module '@npmcli/arborist' {
  interface Node {
    name: string;
    version: string;
    isRoot: boolean;
    isLink: boolean;
    location: string;
  }

  interface Tree {
    inventory: Map<string, Node>;
  }

  interface ArboristOptions {
    path: string;
  }

  class Arborist {
    constructor(options: ArboristOptions);
    loadVirtual(): Promise<Tree>;
  }

  export = Arborist;
}
