import { useQuery } from "@tanstack/react-query";
import { supabase, Product } from "@/lib/supabase";

const PRODUCT_COLS =
  "id, name, brand, group_name, variant_name, selling_price, image_url, main_category, subcategory, weight, delivery_type, description, priority";

export function useSupabaseProducts(category?: string | null) {
  return useQuery<Product[]>({
    queryKey: ["supabase-products", category],
    queryFn: async () => {
      let query = supabase.from("live_products").select(PRODUCT_COLS);

      if (category) {
        // category arg can be a main_category or subcategory; match either
        query = query.or(
          `main_category.eq.${category},subcategory.eq.${category}`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSupabaseProduct(id: string | undefined) {
  return useQuery<Product | null>({
    queryKey: ["supabase-product", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("live_products")
        .select(PRODUCT_COLS)
        .eq("id", id)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });
}

export function useSupabaseCategories() {
  return useQuery<string[]>({
    queryKey: ["supabase-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_products")
        .select("main_category");

      if (error) throw error;
      const unique = [
        ...new Set((data ?? []).map((d) => d.main_category).filter(Boolean)),
      ] as string[];
      return unique.sort();
    },
  });
}

export function useSupabaseSubcategories(mainCategory?: string | null) {
  return useQuery<string[]>({
    queryKey: ["supabase-subcategories", mainCategory],
    queryFn: async () => {
      let query = supabase.from("live_products").select("subcategory, main_category");
      if (mainCategory) {
        query = query.eq("main_category", mainCategory);
      }
      const { data, error } = await query;
      if (error) throw error;
      const unique = [
        ...new Set((data ?? []).map((d) => d.subcategory).filter(Boolean)),
      ] as string[];
      return unique.sort();
    },
    enabled: !!mainCategory,
  });
}
