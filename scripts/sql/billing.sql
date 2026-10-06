-- =====================================================================================================
--  21. LICENCE, WALLET & PAYMENTS — Hospital Comrade phase 4 (loaded last: every hospital table exists)
-- =====================================================================================================
--  • Licence: tenants.trial_ends_at / paid_until → tenant_license() (tenancy_core.sql). In read_only (after the grace
--    period) and suspended hospitals nobody but the platform team can add or change anything: license_guard() runs on
--    every hospital table — also inside website RPCs such as online booking — while reading and signing in still work.
--  • Wallet: prepaid ₹ balance (tenants.wallet_paise) for messages on Hospital Comrade's shared accounts beyond the
--    plan's included messages. Every change is a row in wallet_ledger; usage is one row per day and channel.
--  • Payments: billing_payments (Razorpay orders from the `billing` Edge Function, or manual entries by the platform
--    team). apply_payment() is idempotent: renews the plan or tops up the wallet and numbers the tax invoice.
--  • Prices, GST, trial / grace days and message rates: platform_settings 'billing' (defaults from src/platform/billing.ts);
--    per-hospital overrides in tenants.billing (custom price, included messages, rates).

insert into public.platform_settings (key, data) values ('billing', $json$@@BILLING_DEFAULTS@@$json$::jsonb)
on conflict (key) do update set data = excluded.data || public.platform_settings.data;   -- new keys arrive, saved values win

create or replace function public.billing_config()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select data from public.platform_settings where key = 'billing'), '{}'::jsonb)
$$;

-- ------------------------------------------------------------------ tables
create sequence if not exists public.billing_invoice_seq;

create table if not exists public.billing_payments (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('plan', 'wallet')),
  plan         text,
  months       int check (months is null or months between 1 and 36),
  base_paise   bigint not null check (base_paise >= 0),
  gst_paise    bigint not null default 0 check (gst_paise >= 0),
  total_paise  bigint not null check (total_paise >= 0),
  status       text not null default 'created' check (status in ('created', 'paid', 'failed', 'refunded')),
  provider     text not null default 'razorpay' check (provider in ('razorpay', 'manual')),
  order_id     text unique,
  payment_id   text,
  method       text,
  paid_at      timestamptz,
  invoice_no   text unique,
  period_from  date,
  period_to    date,
  buyer        jsonb not null default '{}'::jsonb,       -- legal name / GSTIN / address at the time of payment
  note         text,
  created_by   uuid
);
-- phase 6: the seller printed on the tax invoice, as it was when the invoice was numbered (invoices never change later)
alter table public.billing_payments add column if not exists seller jsonb;
create index if not exists billing_payments_tenant_idx on public.billing_payments (tenant_id, created_at desc);

create table if not exists public.wallet_ledger (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null default public.current_tenant() references public.tenants (id) on delete cascade,
  created_at     timestamptz not null default now(),
  day            date not null default (now() at time zone 'Asia/Kolkata')::date,
  kind           text not null check (kind in ('topup', 'usage', 'refund', 'adjustment')),
  channel        text check (channel is null or channel in ('sms', 'whatsapp', 'email')),
  units          int not null default 0,
  amount_paise   bigint not null,                        -- + credit, − debit
  balance_paise  bigint not null,                        -- balance after this row
  payment        uuid references public.billing_payments (id) on delete set null,
  note           text,
  created_by     uuid
);
create index if not exists wallet_ledger_tenant_idx on public.wallet_ledger (tenant_id, created_at desc);
create unique index if not exists wallet_ledger_usage_day on public.wallet_ledger (tenant_id, day, channel) where kind = 'usage';

-- read: the hospital's owner and accountant (and the platform team working as them); writes only through the functions
do $rls$
declare t text;
begin
  foreach t in array array['billing_payments', 'wallet_ledger'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists tenant_isolation on public.%I', t);
    execute format('create policy tenant_isolation on public.%I as restrictive for all to anon, authenticated
                      using (tenant_id = (select public.current_tenant())) with check (tenant_id = (select public.current_tenant()))', t);
    execute format('drop policy if exists billing_read on public.%I', t);
    execute format('create policy billing_read on public.%I for select to authenticated using (public.has_role(''owner'', ''accountant''))', t);
    execute format('drop trigger if exists trg_keep_tenant on public.%I', t);
    execute format('create trigger trg_keep_tenant before update of tenant_id on public.%I for each row execute function public.keep_tenant()', t);
  end loop;
end $rls$;

-- the wallet balance and billing overrides are not for visitors or staff (tenants is readable by anon for the website):
-- every other column stays readable, these two only through billing_summary() / my_context()
do $cols$
declare v_cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns where table_schema = 'public' and table_name = 'tenants' and column_name not in ('wallet_paise', 'billing', 'close_reason');
  execute 'revoke select on public.tenants from anon, authenticated';
  execute format('grant select (%s) on public.tenants to anon, authenticated', v_cols);
end $cols$;

-- ------------------------------------------------------------------ licence guard
-- Raised for API callers (anon / authenticated — also inside SECURITY DEFINER RPCs, where `role` still names the
-- caller) in read_only / suspended hospitals. The platform team (admin / finance), the service role (Edge Functions)
-- and the database itself are never blocked.
create or replace function public.license_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_tenant uuid; v_state text;
begin
  if coalesce(current_setting('role', true), '') not in ('anon', 'authenticated') then return coalesce(new, old); end if;
  if public.provider_role() in ('admin', 'finance') then return coalesce(new, old); end if;
  -- privacy rights (consent withdrawal, erasure — phase 7) work even when the plan has ended
  if current_setting('app.privacy', true) = 'on' then return coalesce(new, old); end if;
  v_tenant := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  v_state := public.tenant_license(v_tenant);
  if v_state in ('read_only', 'suspended') then
    raise exception 'LICENSE_READ_ONLY: This hospital''s Hospital Comrade plan has ended, so the account is read-only. The owner can renew it in Settings → Plan & billing.'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

-- every hospital table except the ones that must keep working while read-only (sign-in, password reset, devices,
-- delivery bookkeeping, logs and billing itself)
do $guard$
declare t text;
begin
  for t in select c.table_name from information_schema.columns c
            join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name and x.table_type = 'BASE TABLE'
           where c.table_schema = 'public' and c.column_name = 'tenant_id'
             and c.table_name not in ('tenant_domains', 'provider_assignments', 'provider_audit', 'profiles', 'push_tokens', 'password_reset_otps',
                                      'notification_outbox', 'message_usage', 'audit_log', 'billing_payments', 'wallet_ledger', 'billing_credit_notes',
                                      'privacy_requests', 'consent_log',  -- phase 7: patients' privacy rights work even when read-only
                                      'user_notifications', 'notify_once', 'known_devices')  -- the bell, sign-in devices, daily bookkeeping
  loop
    execute format('drop trigger if exists trg_license_guard on public.%I', t);
    execute format('create trigger trg_license_guard before insert or update or delete on public.%I for each row execute function public.license_guard()', t);
  end loop;
end $guard$;

-- ------------------------------------------------------------------ wallet
create or replace function public.wallet_apply(p_tenant uuid, p_kind text, p_amount bigint, p_payment uuid default null,
  p_note text default null, p_channel text default null, p_units int default 0)
returns bigint language plpgsql volatile security definer set search_path = public as $$
declare v_bal bigint; v_day date := (now() at time zone 'Asia/Kolkata')::date;
begin
  update public.tenants set wallet_paise = wallet_paise + p_amount where id = p_tenant returning wallet_paise into v_bal;
  if not found then raise exception 'No hospital with id %', p_tenant; end if;
  if p_kind = 'usage' then   -- one row per day and channel
    insert into public.wallet_ledger (tenant_id, day, kind, channel, units, amount_paise, balance_paise)
    values (p_tenant, v_day, 'usage', p_channel, p_units, p_amount, v_bal)
    on conflict (tenant_id, day, channel) where kind = 'usage' do update
      set units = public.wallet_ledger.units + excluded.units, amount_paise = public.wallet_ledger.amount_paise + excluded.amount_paise,
          balance_paise = excluded.balance_paise, created_at = now();
  else
    insert into public.wallet_ledger (tenant_id, day, kind, channel, units, amount_paise, balance_paise, payment, note, created_by)
    values (p_tenant, v_day, p_kind, p_channel, coalesce(p_units, 0), p_amount, v_bal, p_payment, p_note, auth.uid());
  end if;
  return v_bal;
end $$;

-- the notify function adds each batch's outcome (service role only). Messages on the shared accounts beyond the
-- plan's included messages this month are charged to the wallet (the primary hospital is never charged).
create or replace function public.record_message_usage(p_tenant uuid, p_channel text, p_source text, p_sent int, p_failed int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_month  date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  v_src    text := coalesce(p_source, 'own');
  v_before int;
  v_inc    int;
  v_rate   int;
  v_units  int;
  t        public.tenants;
  cfg      jsonb := public.billing_config();
begin
  if coalesce(p_sent, 0) = 0 and coalesce(p_failed, 0) = 0 then return; end if;
  select sent into v_before from public.message_usage
   where tenant_id = p_tenant and month = v_month and channel = p_channel and source = v_src for update;
  insert into public.message_usage (tenant_id, month, channel, source, sent, failed)
  values (p_tenant, v_month, p_channel, v_src, greatest(coalesce(p_sent, 0), 0), greatest(coalesce(p_failed, 0), 0))
  on conflict (tenant_id, month, channel, source) do update
    set sent = public.message_usage.sent + excluded.sent, failed = public.message_usage.failed + excluded.failed, updated_at = now();
  if v_src <> 'platform' or coalesce(p_sent, 0) <= 0 or p_channel not in ('sms', 'whatsapp', 'email') then return; end if;
  select * into t from public.tenants where id = p_tenant;
  if not found or t.is_primary then return; end if;
  v_inc  := coalesce((t.billing -> 'included' ->> p_channel)::int, (cfg -> 'plans' -> t.plan -> 'included' ->> p_channel)::int, 0);
  v_rate := coalesce((t.billing -> 'ratesPaise' ->> p_channel)::int, (cfg -> 'ratesPaise' ->> p_channel)::int, 0);
  v_before := coalesce(v_before, 0);
  v_units := greatest(0, v_before + p_sent - greatest(v_inc, v_before));
  if v_units > 0 and v_rate > 0 then
    perform public.wallet_apply(p_tenant, 'usage', -(v_units::bigint * v_rate), null, null, p_channel, v_units);
  end if;
end $$;

-- ------------------------------------------------------------------ prices
-- What a plan renewal (1 or 12 months) or a wallet top-up (₹) costs this hospital, GST included.
-- p_plan (phase 6): renew on another plan — it switches when the payment arrives (custom-priced hospitals: ask the team)
drop function if exists public.billing_quote(uuid, text, int, numeric);
create or replace function public.billing_quote(p_tenant uuid, p_kind text, p_months int default 1, p_amount numeric default null, p_plan text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t      public.tenants;
  v_plan text;
  cfg    jsonb := public.billing_config();
  v_gst  numeric := coalesce((cfg ->> 'gstPercent')::numeric, 18);
  v_price numeric;
  v_base bigint;
  v_from date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into t from public.tenants where id = p_tenant;
  if not found then raise exception 'No hospital selected'; end if;
  if p_kind = 'plan' then
    if coalesce(p_months, 0) not in (1, 12) then raise exception 'Choose 1 month or 12 months.'; end if;
    v_plan := coalesce(nullif(p_plan, ''), t.plan);
    if v_plan <> t.plan then
      if not (cfg -> 'plans' ? v_plan) then raise exception 'Unknown plan %', v_plan; end if;
      if (t.billing ->> 'price') is not null then
        raise exception 'Your price was agreed with Hospital Comrade — ask them to change your plan.';
      end if;
    end if;
    v_price := case when v_plan = t.plan then coalesce((t.billing ->> 'price')::numeric, (cfg -> 'plans' -> t.plan ->> 'price')::numeric)
                    else (cfg -> 'plans' -> v_plan ->> 'price')::numeric end;
    if v_price is null or v_price <= 0 then
      raise exception 'Your plan is priced individually — Hospital Comrade will send you the payment details.';
    end if;
    v_base := round(v_price * 100 * case when p_months = 12 then coalesce((cfg ->> 'yearlyMonths')::int, 12) else 1 end);
    -- the new period starts after whatever is already paid (or the trial), never in the past
    v_from := greatest(v_today, (greatest(coalesce(t.paid_until, '-infinity'::timestamptz), coalesce(t.trial_ends_at, '-infinity'::timestamptz)) at time zone 'Asia/Kolkata')::date);
    return jsonb_build_object('kind', 'plan', 'plan', v_plan, 'months', p_months, 'base_paise', v_base,
      'gst_paise', round(v_base * v_gst / 100)::bigint, 'total_paise', v_base + round(v_base * v_gst / 100)::bigint, 'gst_percent', v_gst,
      'period_from', v_from, 'period_to', (v_from + make_interval(months => p_months) - interval '1 day')::date);
  elsif p_kind = 'wallet' then
    if p_amount is null or p_amount < coalesce((cfg ->> 'minTopup')::numeric, 500) or p_amount > coalesce((cfg ->> 'maxTopup')::numeric, 100000) then
      raise exception 'Top up between ₹% and ₹%.', coalesce(cfg ->> 'minTopup', '500'), coalesce(cfg ->> 'maxTopup', '100000');
    end if;
    v_base := round(p_amount * 100);
    return jsonb_build_object('kind', 'wallet', 'months', null, 'base_paise', v_base, 'gst_paise', round(v_base * v_gst / 100)::bigint,
      'total_paise', v_base + round(v_base * v_gst / 100)::bigint, 'gst_percent', v_gst);
  end if;
  raise exception 'Unknown payment type';
end $$;

-- ------------------------------------------------------------------ payments
-- Marks a payment paid (once — repeats are ignored), numbers the tax invoice (HC/2026-27/000001, Indian financial
-- year) and applies it: a plan renewal extends paid_until by its months, a top-up credits the wallet (GST excluded).
create or replace function public.apply_payment(p_payment uuid, p_ref text default null, p_method text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  p      public.billing_payments;
  v_d    date := (now() at time zone 'Asia/Kolkata')::date;
  v_fy   text;
  v_inv  text;
  t      public.tenants;
begin
  select * into p from public.billing_payments where id = p_payment for update;
  if not found then raise exception 'Payment not found'; end if;
  if p.status = 'paid' then return jsonb_build_object('ok', true, 'already', true, 'invoice_no', p.invoice_no); end if;
  v_fy := case when extract(month from v_d) >= 4 then to_char(v_d, 'YYYY') || '-' || to_char(v_d + interval '1 year', 'YY')
               else to_char(v_d - interval '1 year', 'YYYY') || '-' || to_char(v_d, 'YY') end;
  v_inv := 'HC/' || v_fy || '/' || lpad(nextval('public.billing_invoice_seq')::text, 6, '0');
  select * into t from public.tenants where id = p.tenant_id for update;
  update public.billing_payments set status = 'paid', paid_at = now(), invoice_no = v_inv,
         payment_id = coalesce(p_ref, payment_id), method = coalesce(p_method, method),
         seller = coalesce(seller, public.billing_config() -> 'seller'),
         buyer = case when buyer = '{}'::jsonb then jsonb_build_object('name', coalesce(t.billing ->> 'legalName', t.name), 'gstin', coalesce(t.billing ->> 'gstin', ''),
                                                                       'address', coalesce(t.billing ->> 'address', '')) else buyer end
   where id = p.id;
  if p.kind = 'plan' then
    update public.tenants
       set plan = coalesce(p.plan, plan),
           paid_until = greatest(now(), coalesce(paid_until, now()), coalesce(trial_ends_at, now())) + make_interval(months => coalesce(p.months, 1)),
           status = case when status = 'suspended' then status else 'active' end
     where id = p.tenant_id;
  else
    perform public.wallet_apply(p.tenant_id, 'topup', p.base_paise, p.id, 'Wallet top-up · ' || v_inv);
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'invoice_no', v_inv);
end $$;

-- ------------------------------------------------------------------ for the app (owner / accountant / platform team)
create or replace function public.billing_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  t      public.tenants;
  cfg    jsonb := public.billing_config();
  v_month date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
begin
  if not public.has_role('owner', 'accountant') then raise exception 'Only the owner or accountant can see billing.' using errcode = '42501'; end if;
  select * into t from public.tenants where id = public.current_tenant();
  if not found then return null; end if;
  return jsonb_build_object(
    'license', public.tenant_license_dates(t.id), 'is_primary', t.is_primary,
    'plan', t.plan,
    'price', coalesce((t.billing ->> 'price')::numeric, (cfg -> 'plans' -> t.plan ->> 'price')::numeric),
    'included', coalesce(cfg -> 'plans' -> t.plan -> 'included', '{}'::jsonb) || coalesce(t.billing -> 'included', '{}'::jsonb),
    'rates_paise', coalesce(cfg -> 'ratesPaise', '{}'::jsonb) || coalesce(t.billing -> 'ratesPaise', '{}'::jsonb),
    'wallet_paise', t.wallet_paise,
    'gst_percent', coalesce((cfg ->> 'gstPercent')::numeric, 18), 'yearly_months', coalesce((cfg ->> 'yearlyMonths')::int, 12),
    'min_topup', coalesce((cfg ->> 'minTopup')::numeric, 500), 'max_topup', coalesce((cfg ->> 'maxTopup')::numeric, 100000),
    'buyer', jsonb_build_object('legalName', coalesce(t.billing ->> 'legalName', t.name), 'gstin', coalesce(t.billing ->> 'gstin', ''), 'address', coalesce(t.billing ->> 'address', '')),
    -- phase 6: plan picker + invoices
    'custom_price', (t.billing ->> 'price') is not null,
    'plans', coalesce((select jsonb_object_agg(e.key, jsonb_build_object('price', e.value -> 'price', 'included', e.value -> 'included')) from jsonb_each(cfg -> 'plans') e), '{}'::jsonb),
    'seller', coalesce(cfg -> 'seller', '{}'::jsonb),
    'usage', coalesce((select jsonb_object_agg(channel, sent) from public.message_usage where tenant_id = t.id and month = v_month and source = 'platform'), '{}'::jsonb));
end $$;

drop function if exists public.my_billing_quote(text, int, numeric);
create or replace function public.my_billing_quote(p_kind text, p_months int default 1, p_amount numeric default null, p_plan text default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role('owner', 'accountant') then raise exception 'Only the owner or accountant can see prices.' using errcode = '42501'; end if;
  return public.billing_quote(public.current_tenant(), p_kind, p_months, p_amount, p_plan);
end $$;

-- phase 6: during the free trial (nothing paid yet) the owner may try another plan straight away
create or replace function public.change_trial_plan(p_plan text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare t public.tenants; cfg jsonb := public.billing_config();
begin
  if not public.has_role('owner') then raise exception 'Only the owner can change the plan.' using errcode = '42501'; end if;
  select * into t from public.tenants where id = public.current_tenant() for update;
  if not found or t.is_primary then raise exception 'No plan to change here.'; end if;
  if not (cfg -> 'plans' ? coalesce(p_plan, '')) then raise exception 'Unknown plan %', p_plan; end if;
  if (cfg -> 'plans' -> p_plan ->> 'price') is null then raise exception 'That plan is priced individually — Hospital Comrade will get in touch.'; end if;
  if (t.billing ->> 'price') is not null then raise exception 'Your price was agreed with Hospital Comrade — ask them to change your plan.'; end if;
  if public.tenant_license(t.id) <> 'trial' or coalesce(t.paid_until > now(), false) then
    raise exception 'Your plan is paid — choose the new plan when you renew; it switches when the payment arrives.';
  end if;
  update public.tenants set plan = p_plan, updated_at = now() where id = t.id;
  return public.billing_summary();
end $$;

-- phase 6: messages per month on the shared accounts (sent, included, charged to the wallet) — the usage chart
create or replace function public.billing_usage_history(p_months int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_t   uuid := public.current_tenant();
  v_now date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  v_n   int := least(greatest(coalesce(p_months, 6), 1), 24);
begin
  if not public.has_role('owner', 'accountant') then raise exception 'Only the owner or accountant can see billing.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'month', to_char(m.month, 'YYYY-MM'),
      'sent', coalesce((select jsonb_object_agg(u.channel, u.sent) from public.message_usage u where u.tenant_id = v_t and u.month = m.month and u.source = 'platform' and u.channel <> 'push'), '{}'::jsonb),
      'own', coalesce((select sum(u.sent) from public.message_usage u where u.tenant_id = v_t and u.month = m.month and u.source = 'own'), 0),
      'charged_paise', coalesce((select -sum(l.amount_paise) from public.wallet_ledger l where l.tenant_id = v_t and l.kind = 'usage'
                                   and date_trunc('month', l.day)::date = m.month), 0)) order by m.month)
    from (select (v_now - make_interval(months => g))::date as month from generate_series(v_n - 1, 0, -1) g) m), '[]'::jsonb);
end $$;

-- phase 6: renewal reminders to each hospital's owner — 30, 15, 7, 3 and 1 day before the trial / plan ends, and once when
-- the grace period starts. E-mail + app push + in-app bell (control panel → Templates: SUB-001 may change channels / wording).
-- Daily from the scheduler (Settings → Notifications → automatic delivery).
create or replace function public.queue_billing_reminders()
returns int language plpgsql volatile security definer set search_path = public as $$
declare
  r       record;
  v_count int := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_left  int;
  v_m     text;
  v_end   timestamptz;
  v_name  text;
  v_mail  text;
  v_prof  uuid;
  v_subj  text;
  v_body  text;
  v_link  text;
  cfg     jsonb := public.billing_config();
begin
  if auth.uid() is not null and coalesce(public.provider_role(), '') <> 'admin' then raise exception 'Not allowed' using errcode = '42501'; end if;
  for r in select t.*, public.tenant_license(t.id) as lic from public.tenants t where not t.is_primary and t.status <> 'suspended' loop
    v_end := greatest(coalesce(r.paid_until, '-infinity'::timestamptz), coalesce(r.trial_ends_at, '-infinity'::timestamptz));
    continue when v_end = '-infinity'::timestamptz;
    v_left := ((v_end at time zone 'Asia/Kolkata')::date - v_today);
    v_m := case when r.lic in ('trial', 'active') and v_left in (30, 15, 7, 3, 1) then 'd' || v_left
                when r.lic = 'grace' then 'grace' end;
    continue when v_m is null;
    -- once per hospital, milestone and end date (paying moves the end date, so the next round starts fresh)
    continue when exists (select 1 from public.notification_outbox o where o.tenant_id = r.id and o.event = 'billing_reminder'
                            and o.vars ->> 'milestone' = v_m and o.vars ->> 'until' = to_char(v_end at time zone 'Asia/Kolkata', 'YYYY-MM-DD'));
    select p.id, p.full_name, p.email into v_prof, v_name, v_mail from public.profiles p where p.tenant_id = r.id and p.role = 'owner' order by p.created_at limit 1;
    v_mail := coalesce(v_mail, (select s.data ->> 'owner_email' from public.app_settings s where s.tenant_id = r.id and s.key = 'bootstrap'));
    continue when v_mail is null and v_prof is null;
    v_link := coalesce((select 'https://' || d.domain || '/billing' from public.tenant_domains d where d.tenant_id = r.id order by d.is_primary desc, (d.verified_at is null), d.created_at limit 1),
                       nullif(rtrim(coalesce((select c.data ->> 'siteUrl' from public.site_content c where c.tenant_id = r.id and c.key = 'settings'), ''), '/') || '/billing', '/billing'),
                       'the app → Billing & plan');
    v_subj := case when v_m = 'grace' then '{hospital}: renew now to keep adding records'
                   when r.lic = 'trial' then '{hospital}: your free trial ends {date}'
                   else '{hospital}: your plan renews {date}' end;
    v_body := case when v_m = 'grace'
      then 'Namaste {name}, the {plan} plan for {hospital} has ended. Everything still works until {read_only}; after that the app becomes read-only until you renew. Renew in a minute: {link}'
      else 'Namaste {name}, the ' || case when r.lic = 'trial' then 'free trial' else '{plan} plan' end
           || ' for {hospital} ends on {date} ({days}). Renew in a minute: {link} — UPI, cards and net banking, with a GST invoice.' end;
    perform set_config('app.tenant_id', r.id::text, true);
    -- one per hospital reminded (email + push + bell count once)
    if public.notify_enqueue_raw('billing_reminder',
      jsonb_build_object('subject', v_subj, 'text', v_body), array['email', 'push', 'inapp'], null, v_mail, v_prof,
      jsonb_build_object('name', split_part(coalesce(v_name, 'there'), ' ', 1), 'milestone', v_m,
        'hospital', coalesce(nullif((select c.data ->> 'name' from public.site_content c where c.tenant_id = r.id and c.key = 'settings'), ''), r.name),
        'until', to_char(v_end at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), 'date', to_char(v_end at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
        'days', case when v_left = 1 then 'tomorrow' else 'in ' || v_left || ' days' end,
        'read_only', to_char((v_end + make_interval(days => coalesce((cfg ->> 'graceDays')::int, 7))) at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
        'plan', initcap(r.plan), 'link', v_link),
      'tenants', r.id, null) > 0 then v_count := v_count + 1; end if;
  end loop;
  perform set_config('app.tenant_id', '', true);
  return v_count;
end $$;

-- the owner keeps the name and GSTIN printed on Hospital Comrade's invoices up to date
create or replace function public.set_billing_details(p_legal_name text, p_gstin text, p_address text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare v_gstin text := upper(regexp_replace(coalesce(p_gstin, ''), '\s', '', 'g'));
begin
  if not public.has_role('owner') then raise exception 'Only the owner can change billing details.' using errcode = '42501'; end if;
  if v_gstin <> '' and v_gstin !~ '^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters, e.g. 10ABCDE1234F1Z5).'; end if;
  update public.tenants set billing = billing || jsonb_build_object('legalName', left(trim(coalesce(p_legal_name, '')), 150), 'gstin', v_gstin, 'address', left(trim(coalesce(p_address, '')), 300))
   where id = public.current_tenant();
end $$;

-- ------------------------------------------------------------------ platform team tools (until the provider panel)
-- Works on the hospital chosen in the provider banner. admin: everything; finance: manual payments + wallet adjustments.
--   manual_payment  { kind: plan|wallet, months?, amount?, method: bank|upi|cash|cheque, reference?, note? }
--   wallet_adjust   { amount: ±₹, note }            extend_trial { days }            (admin)
--   set_plan        { plan?, price?, included?, ratesPaise? }  (admin; price null = plan price)
--   suspend / resume                                          (admin)
create or replace function public.provider_billing(p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_mode   text := public.provider_mode();
  v_tenant uuid := public.current_tenant();
  q        jsonb;
  v_id     uuid;
  r        jsonb;
  v_amt    numeric;
  cfg      jsonb := public.billing_config();
begin
  if v_mode not in ('admin', 'finance') or not public.provider_can(v_tenant) then
    raise exception 'Only Hospital Comrade admins or finance can do this.' using errcode = '42501';
  end if;
  if p_action in ('extend_trial', 'set_plan', 'suspend', 'resume') and v_mode <> 'admin' then
    raise exception 'Only a Hospital Comrade admin can do this.' using errcode = '42501';
  end if;
  if p_action = 'manual_payment' then
    q := public.billing_quote(v_tenant, p_args ->> 'kind', coalesce((p_args ->> 'months')::int, 1), (p_args ->> 'amount')::numeric, p_args ->> 'plan');
    insert into public.billing_payments (tenant_id, kind, plan, months, base_paise, gst_paise, total_paise, provider, method, payment_id, note,
                                         period_from, period_to, created_by)
    values (v_tenant, q ->> 'kind', q ->> 'plan', (q ->> 'months')::int, (q ->> 'base_paise')::bigint, (q ->> 'gst_paise')::bigint, (q ->> 'total_paise')::bigint,
            'manual', coalesce(nullif(p_args ->> 'method', ''), 'bank'), nullif(p_args ->> 'reference', ''), nullif(p_args ->> 'note', ''),
            (q ->> 'period_from')::date, (q ->> 'period_to')::date, auth.uid())
    returning id into v_id;
    r := public.apply_payment(v_id);
  elsif p_action = 'wallet_adjust' then
    v_amt := (p_args ->> 'amount')::numeric;
    if v_amt is null or v_amt = 0 or abs(v_amt) > 100000 then raise exception 'Enter an amount between -₹1,00,000 and ₹1,00,000.'; end if;
    if coalesce(trim(p_args ->> 'note'), '') = '' then raise exception 'Add a note saying why.'; end if;
    r := jsonb_build_object('wallet_paise', public.wallet_apply(v_tenant, 'adjustment', round(v_amt * 100)::bigint, null, left(p_args ->> 'note', 200)));
  elsif p_action = 'extend_trial' then
    if coalesce((p_args ->> 'days')::int, 0) not between 1 and 90 then raise exception 'Extend by 1 to 90 days.'; end if;
    update public.tenants set trial_ends_at = greatest(now(), coalesce(trial_ends_at, now())) + make_interval(days => (p_args ->> 'days')::int),
                              status = case when status in ('suspended', 'active') then status else 'trial' end
     where id = v_tenant;
  elsif p_action = 'set_plan' then
    if p_args ? 'plan' and not (cfg -> 'plans' ? (p_args ->> 'plan')) then raise exception 'Unknown plan'; end if;
    update public.tenants
       set plan = coalesce(p_args ->> 'plan', plan),
           billing = (billing - 'price' - 'included' - 'ratesPaise')
                     || case when p_args ? 'price' and p_args -> 'price' <> 'null'::jsonb then jsonb_build_object('price', (p_args ->> 'price')::numeric)
                             when not (p_args ? 'price') and billing ? 'price' then jsonb_build_object('price', billing -> 'price') else '{}'::jsonb end
                     || case when p_args ? 'included' then jsonb_build_object('included', p_args -> 'included')
                             when billing ? 'included' then jsonb_build_object('included', billing -> 'included') else '{}'::jsonb end
                     || case when p_args ? 'ratesPaise' then jsonb_build_object('ratesPaise', p_args -> 'ratesPaise')
                             when billing ? 'ratesPaise' then jsonb_build_object('ratesPaise', billing -> 'ratesPaise') else '{}'::jsonb end
     where id = v_tenant;
  elsif p_action = 'suspend' then
    update public.tenants set status = 'suspended' where id = v_tenant and not is_primary;
  elsif p_action = 'resume' then
    update public.tenants set status = case when paid_until > now() then 'active' when trial_ends_at > now() then 'trial' else 'active' end
     where id = v_tenant and status = 'suspended';
  else
    raise exception 'Unknown action %', p_action;
  end if;
  perform public.provider_log('billing:' || p_action, v_tenant::text, p_args);
  return coalesce(r, '{}'::jsonb) || jsonb_build_object('license', public.tenant_license_dates(v_tenant));
end $$;

-- ------------------------------------------------------------------ who may call what
revoke all on function public.billing_config(), public.license_guard(), public.wallet_apply(uuid, text, bigint, uuid, text, text, int),
  public.record_message_usage(uuid, text, text, int, int), public.billing_quote(uuid, text, int, numeric, text),
  public.apply_payment(uuid, text, text), public.queue_billing_reminders() from public, anon, authenticated;
grant execute on function public.record_message_usage(uuid, text, text, int, int), public.billing_quote(uuid, text, int, numeric, text),
  public.apply_payment(uuid, text, text), public.queue_billing_reminders() to service_role;
revoke all on function public.billing_summary(), public.my_billing_quote(text, int, numeric, text), public.set_billing_details(text, text, text),
  public.provider_billing(text, jsonb), public.change_trial_plan(text), public.billing_usage_history(int) from public, anon;
grant execute on function public.billing_summary(), public.my_billing_quote(text, int, numeric, text), public.set_billing_details(text, text, text),
  public.provider_billing(text, jsonb), public.change_trial_plan(text), public.billing_usage_history(int) to authenticated;
-- tenant_license (status word only) is needed by license_guard(), which runs as the caller. The dates (trial / paid until /
-- purge) are only handed out through my_context() / billing_summary() / the control panel — never for any hospital id.
grant execute on function public.tenant_license(uuid) to anon, authenticated, service_role;
revoke all on function public.tenant_license_dates(uuid) from public, anon, authenticated;
grant execute on function public.tenant_license_dates(uuid) to service_role;
