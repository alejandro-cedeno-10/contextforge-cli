import { promises as fs } from "node:fs";

import { blake3 } from "@noble/hashes/blake3";

export function blake3Hex(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return Buffer.from(blake3(bytes)).toString("hex");
}

export async function blake3HexFromFile(filePath: string): Promise<string> {
  const content = await fs.readFile(filePath);
  return blake3Hex(content);
}
