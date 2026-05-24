import { useQuery } from "@tanstack/react-query";
import { supabase, Product } from "@/lib/supabase";

const TABLE = "products_master";
const PUBLISHED = "published";

function logError(scope: string, error: unknown, extra?: Record<string, unknown>) {
  // Temporary diagnostics for the products_master cutover.
  // eslint-disable-next-line no-console
  console.error(`[products_master] ${scope} failed`, { error, ...extra });
}

export function useSupabaseProducts(category?: string | null) {
  return useQuery<Product[]>({
    queryKey: ["supabase-products", category],
    queryFn: async () => {
      let query = supabase.from(TABLE).select("*").eq("status", PUBLISHED);

      if (category) {
        // category arg can be a main_category or subcategory; match either
        query = query.or(
          `main_category.eq.${category},subcategory.eq.${category}`,
        );
      }

      const { data, error } = await query;
      if (error) {
        logError("list", error, { table: TABLE, category });
        throw error;
      }
      return (data ?? []) as unknown as Product[];
    },
  });
}

export function useSupabaseProduct(id: string | undefined) {
  return useQuery<Product | null>({
    queryKey: ["supabase-product", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("status", PUBLISHED)
        .eq("id", id)
        .maybeSingle();

      if (error) {
        logError("detail", error, { table: TABLE, id });
        throw error;
      }
      return (data ?? null) as unknown as Product | null;
    },
    enabled: !!id,
  });
}

export function useSupabaseCategories() {
  return useQuery<string[]>({
    queryKey: ["supabase-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(TABLE)
        .select("main_category")
        .eq("status", PUBLISHED);

      if (error) {
        logError("categories", error, { table: TABLE });
        throw error;
      }
      const unique = [
        ...new Set((data ?? []).map((d: any) => d.main_category).filter(Boolean)),
      ] as string[];
      return unique.sort();
    },
  });
}

export function useSupabaseSubcategories(mainCategory?: string | null) {
  return useQuery<string[]>({
    queryKey: ["supabase-subcategories", mainCategory],
    queryFn: async () => {
      let query = supabase
        .from(TABLE)
        .select("subcategory, main_category")
        .eq("status", PUBLISHED);
      if (mainCategory) {
        query = query.eq("main_category", mainCategory);
      }
      const { data, error } = await query;
      if (error) {
        logError("subcategories", error, { table: TABLE, mainCategory });
        throw error;
      }
      const unique = [
        ...new Set((data ?? []).map((d: any) => d.subcategory).filter(Boolean)),
      ] as string[];
      return unique.sort();
    },
    enabled: !!mainCategory,
  });
}
