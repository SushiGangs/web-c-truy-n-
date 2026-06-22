import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://yooddcsinzfplevsaqhf.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_B7HJpqtvHQW4PFkHag4Hxw_b1HuN_qG';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
