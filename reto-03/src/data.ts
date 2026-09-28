import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(process.cwd(), "fixtures");

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

export async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

export function casePath(caso: string, file: string): string {
  return join(ROOT, caso, file);
}

export function masterPath(file: string): string {
  return join(ROOT, file);
}
