import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// Catalog reads only — no auth. This client now shares the same Supabase
// project as the main auth client, so disable session persistence/refresh to
// avoid two GoTrue instances clobbering each other's tokens in localStorage.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  group_name: string | null;
  variant_name: string | null;
  selling_price: number;
  image_url: string;
  main_category: string | null;
  subcategory: string | null;
  weight: number | null;
  delivery_type: string | null;
  description: string | null;
  priority: string | null;
};
