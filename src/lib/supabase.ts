import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dkgjsobfljqoggalivzt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hjMIhO09DS62uJCvhgJoOQ_SY_CZepJ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type Product = {
  id: string;
  name: string;
  brand: string | null;
  group_name: string | null;
  selling_price: number;
  image_url: string;
  category: string | null;
  weight: number | null;
  delivery_type: string | null;
};
