-- ============================================================================
-- LIAD — מסד הנתונים ב-Supabase
--
-- להעתיק את כל הקובץ הזה אל SQL Editor ב-Supabase וללחוץ Run.
-- אפשר להריץ אותו שוב ושוב בלי לשבור כלום.
--
-- מבנה:
--   site_state  — כל מה שנערך במערכת הניהול (קטלוג, קטגוריות, דף הבית,
--                 פופאפים). שורה אחת לכל נושא, עם JSON בפנים.
--                 למה JSON ולא טבלה לכל דבר: זה בדיוק המבנה שהאתר כבר
--                 עובד איתו היום, ולכן המעבר לא דורש לשכתב את האתר.
--   coupons     — קופונים. טבלה אמיתית, כי צריך לבדוק תוקף ומכסת שימושים.
--   orders      — הזמנות. טבלה אמיתית, כי צריך לחפש לפי מספר הזמנה
--                 (מעקב) ולסנן לפי סטטוס.
--   leads       — לקוחות שהשאירו פרטים.
--
-- אבטחה (RLS):
--   הכלל הוא "הכי פחות שאפשר". גולשת אנונימית יכולה רק:
--     · לקרוא את תוכן האתר ואת הקופונים
--     · ליצור הזמנה וליד
--     · לקרוא הזמנה אחת, אם היא יודעת את מספר ההזמנה המדויק
--   היא לא יכולה לשנות תוכן, לראות את רשימת הלקוחות, או לשנות סטטוס.
--   כל אלה דורשים התחברות (משתמש מחובר = בעלת החנות).
-- ============================================================================


-- ============================================================================
-- 1. תוכן האתר ומערכת הניהול
-- ============================================================================

create table if not exists public.site_state (
  key         text primary key,
  value       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

comment on table public.site_state is
  'כל מה שנערך במערכת הניהול. key = admin-catalog / admin-categories / admin-homepage / admin-popups';


-- ============================================================================
-- 2. קופונים
-- ============================================================================

create table if not exists public.coupons (
  code              text primary key,
  type              text not null default 'percent' check (type in ('percent', 'fixed')),
  value             numeric not null default 0,
  label             text,
  expires_at        date,
  max_uses          integer,
  used              integer not null default 0,
  first_order_only  boolean not null default false,
  active            boolean not null default true,
  created_at        timestamptz not null default now()
);


-- ============================================================================
-- 3. הזמנות
-- ============================================================================

create table if not exists public.orders (
  id          text primary key,          -- LIAD-260806-A4K9
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- הפרטים נשמרים כ-JSON כי זו תמונת מצב של רגע ההזמנה:
  -- גם אם המחיר או הכתובת ישתנו אחר כך, ההזמנה חייבת להישאר כפי שהייתה.
  customer    jsonb not null default '{}'::jsonb,
  shipping    jsonb not null default '{}'::jsonb,
  items       jsonb not null default '[]'::jsonb,
  totals      jsonb not null default '{}'::jsonb,
  payment     jsonb not null default '{}'::jsonb,
  notes       text default '',

  status         text not null default 'received'
                 check (status in ('received','preparing','ready','shipped','delivered','cancelled')),
  status_history jsonb not null default '[]'::jsonb
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_status_idx     on public.orders (status);


-- ============================================================================
-- 4. לידים
-- ============================================================================

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  name        text default '',
  email       text default '',
  phone       text default '',
  sources     text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- אותו אדם לא נרשם פעמיים. המפתח הוא המייל, ואם אין — הטלפון.
create unique index if not exists leads_identity_idx
  on public.leads ((coalesce(nullif(lower(trim(email)), ''), lower(trim(phone)))));

create index if not exists leads_created_at_idx on public.leads (created_at desc);


-- ============================================================================
-- 5. עדכון אוטומטי של updated_at
-- ============================================================================

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists site_state_touch on public.site_state;
create trigger site_state_touch before update on public.site_state
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();


-- ============================================================================
-- 6. אבטחה — Row Level Security
--
-- בלי החלק הזה כל אחד עם כתובת האתר יכול למחוק לך את הקטלוג.
-- ============================================================================

alter table public.site_state enable row level security;
alter table public.coupons    enable row level security;
alter table public.orders     enable row level security;
alter table public.leads      enable row level security;

-- ---------- תוכן האתר: כולם קוראים, רק מחוברת כותבת ----------

drop policy if exists site_state_read  on public.site_state;
drop policy if exists site_state_write on public.site_state;

create policy site_state_read on public.site_state
  for select using (true);

create policy site_state_write on public.site_state
  for all to authenticated using (true) with check (true);

-- ---------- קופונים: כולם קוראים (הצ׳קאאוט צריך לבדוק), רק מחוברת כותבת ----------

drop policy if exists coupons_read  on public.coupons;
drop policy if exists coupons_write on public.coupons;

create policy coupons_read on public.coupons
  for select using (true);

create policy coupons_write on public.coupons
  for all to authenticated using (true) with check (true);

-- ---------- הזמנות ----------
--
-- הקונה יוצרת הזמנה, וקוראת אותה לפי מספר ההזמנה.
-- היא לא יכולה לשנות אותה, ולא לראות הזמנות של אחרות: המספר אקראי,
-- והשאילתה של דף המעקב מסננת לפי id מדויק.
-- בעלת החנות (מחוברת) רואה ומעדכנת הכול.

drop policy if exists orders_insert       on public.orders;
drop policy if exists orders_read_by_id   on public.orders;
drop policy if exists orders_owner_manage on public.orders;

create policy orders_insert on public.orders
  for insert to anon, authenticated with check (true);

create policy orders_read_by_id on public.orders
  for select using (true);

create policy orders_owner_manage on public.orders
  for update to authenticated using (true) with check (true);

-- ---------- לידים ----------
--
-- הקונה יכולה להירשם, אבל לא לקרוא את הרשימה. רשימת הלקוחות היא
-- נכס עסקי — ואסור שתהיה פתוחה לכל מי שפותח את קוד המקור.

drop policy if exists leads_insert       on public.leads;
drop policy if exists leads_owner_read   on public.leads;
drop policy if exists leads_owner_manage on public.leads;

create policy leads_insert on public.leads
  for insert to anon, authenticated with check (true);

create policy leads_owner_read on public.leads
  for select to authenticated using (true);

create policy leads_owner_manage on public.leads
  for all to authenticated using (true) with check (true);


-- ============================================================================
-- 7. הרשמה חוזרת של ליד קיים
--
-- אנונימית לא יכולה לקרוא את טבלת הלידים, ולכן היא גם לא יכולה לבדוק
-- אם היא כבר רשומה. הפונקציה הזו עושה את זה בשבילה בצד השרת: מוסיפה
-- או מעדכנת, בלי לחשוף שום רשומה.
-- ============================================================================

create or replace function public.record_lead(
  p_name text,
  p_email text,
  p_phone text,
  p_source text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  identity text := coalesce(nullif(lower(trim(p_email)), ''), lower(trim(p_phone)));
begin
  if identity is null or identity = '' then
    return;
  end if;

  insert into public.leads (name, email, phone, sources)
  values (trim(p_name), trim(p_email), trim(p_phone), array[p_source])
  on conflict ((coalesce(nullif(lower(trim(email)), ''), lower(trim(phone)))))
  do update set
    name    = case when trim(excluded.name)  <> '' then excluded.name  else leads.name  end,
    email   = case when trim(excluded.email) <> '' then excluded.email else leads.email end,
    phone   = case when trim(excluded.phone) <> '' then excluded.phone else leads.phone end,
    sources = (
      select array_agg(distinct s)
      from unnest(leads.sources || excluded.sources) as s
    );
end;
$$;

grant execute on function public.record_lead(text, text, text, text) to anon, authenticated;


-- ============================================================================
-- 8. ערכי פתיחה
-- ============================================================================

insert into public.site_state (key, value) values
  ('admin-catalog',    '{"edits":{},"added":[],"removed":[]}'::jsonb),
  ('admin-categories', '{}'::jsonb),
  ('admin-homepage',   '{"text":{},"images":{},"sections":{},"order":[],"banners":[],"featured":null}'::jsonb),
  ('admin-popups',     '[]'::jsonb)
on conflict (key) do nothing;

insert into public.coupons (code, type, value, label, first_order_only, active)
values ('LIAD10', 'percent', 10, '10% לרכישה ראשונה', true, true)
on conflict (code) do nothing;
