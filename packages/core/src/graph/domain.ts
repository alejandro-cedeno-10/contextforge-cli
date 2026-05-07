export function getDomain(filePath: string): string {
  const parts = filePath.split("/");
  if (parts[0] === "packages" && parts.length > 1)
    return `packages/${parts[1]}`;
  return parts[0] ?? "root";
}
