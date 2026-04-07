import { useQuery } from "@tanstack/react-query";
import { supabase, SupabaseProduct } from "@/lib/supabase";

export function useSupabaseProducts() {
  return useQuery<SupabaseProduct[]>({
    queryKey: ["supabase-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("product")
        .select("id, name, image_url, selling_price, delivery_time");

      if (error) throw error;
      return data ?? [];
    },
  });
}
