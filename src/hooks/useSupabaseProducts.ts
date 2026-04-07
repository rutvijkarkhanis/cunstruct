import { useQuery } from "@tanstack/react-query";
import { supabase, Product } from "@/lib/supabase";

export function useSupabaseProducts(category?: string | null) {
  return useQuery<Product[]>({
    queryKey: ["supabase-products", category],
    queryFn: async () => {
      let query = supabase
        .from("product")
        .select("id, name, brand, selling_price, image_url, category");

      if (category) {
        query = query.eq("category", category);
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
        .from("product")
        .select("id, name, brand, selling_price, image_url, category")
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
        .from("product")
        .select("category");

      if (error) throw error;
      const unique = [...new Set((data ?? []).map((d) => d.category).filter(Boolean))] as string[];
      return unique.sort();
    },
  });
}
