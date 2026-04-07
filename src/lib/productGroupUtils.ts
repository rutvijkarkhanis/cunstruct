/** Parse group_name into brand (first word) and product name (rest) */
export function parseGroupName(groupName: string): { brand: string; productName: string } {
  const parts = groupName.trim().split(/\s+/);
  if (parts.length <= 1) return { brand: "", productName: groupName };
  return { brand: parts[0], productName: parts.slice(1).join(" ") };
}

/** Extract a short variant label from a product name given the product name portion of the group */
export function extractVariantLabel(name: string, productName: string): string {
  // Remove the product name portion from the full name
  let label = name.replace(productName, "").trim();
  // Remove brackets
  label = label.replace(/[()[\]]/g, "").trim();
  // If nothing left, return full name
  return label || name;
}
