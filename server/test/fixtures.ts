import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Builds throwaway sysfs/procfs trees on disk. The hardware collectors all
 * read plain kernel files, so a directory of fixtures reproduces a Pi 5, a
 * Pi 4 or a machine with no sensors at all, exactly and without mocking fs.
 */
export interface FileTree {
  [name: string]: string | FileTree;
}

const created: string[] = [];

export async function fixtureDir(tree: FileTree = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mopitor-"));
  created.push(root);
  await writeTree(root, tree);
  return root;
}

/** a single file inside a fresh directory — returns the file's path */
export async function fixtureFile(name: string, content: string): Promise<string> {
  return path.join(await fixtureDir({ [name]: content }), name);
}

async function writeTree(dir: string, tree: FileTree): Promise<void> {
  await mkdir(dir, { recursive: true });
  for (const [name, value] of Object.entries(tree)) {
    const target = path.join(dir, name);
    if (typeof value === "string") await writeFile(target, value);
    else await writeTree(target, value);
  }
}

export async function cleanupFixtures(): Promise<void> {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
}
