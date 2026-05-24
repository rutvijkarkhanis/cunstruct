/** Parse group_name into brand (first word) and product name (rest) */
export function parseGroupName(groupName: string | null | undefined): { brand: string; productName: string } {
  const safe = (groupName ?? "").trim();
  if (!safe) return { brand: "", productName: "" };
  const parts = safe.split(/\s+/);
  if (parts.length <= 1) return { brand: "", productName: safe };
  return { brand: parts[0], productName: parts.slice(1).join(" ") };
}

/** Extract a short variant label from a product name given the product name portion of the group */
export function extractVariantLabel(name: string | null | undefined, productName: string | null | undefined): string {
  const safeName = name ?? "";
  const safeProductName = productName ?? "";
  let label = safeProductName ? safeName.replace(safeProductName, "").trim() : safeName.trim();
  label = label.replace(/[()[\]]/g, "").trim();
  return label || safeName || "Variant";
}
