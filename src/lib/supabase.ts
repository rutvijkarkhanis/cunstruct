import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dkgjsobfljqoggalivzt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hjMIhO09DS62uJCvhgJoOQ_SY_CZepJ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type SupabaseProduct = {
  id: string | number;
  name: string;
  image_url: string;
  selling_price: number;
  delivery_time: string;
};
