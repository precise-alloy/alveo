export type AlveoContext = {
  projectRoot: string;
  packageRoot: string;
  srcRoot: string;
  outDir: string;
  env: Record<string, string>;
  mode: string;
};
