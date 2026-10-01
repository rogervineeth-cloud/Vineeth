-- Rollback for migration 016 (Razorpay payment orders).
--
-- REFUSES to run while any payment order exists: orders, events and refunds
-- are financial records, and user_plans / user_addons rows granted by a
-- payment reference them. Export and reconcile them first; dropping them is a
-- deliberate, separate decision.

do $$
begin
  if exists (select 1 from public.payment_orders) then
    raise exception '016 rollback refused: payment_orders is not empty (financial records)';
  end if;
end;
$$;

drop function if exists public.record_payment_refund(text, text, integer, text);
drop function if exists public.mark_payment_event_processed(text);
drop function if exists public.record_payment_event(text, text, text, jsonb);
drop function if exists public.record_payment_failure(text, text);
drop function if exists public.fulfil_payment_order(text, text, integer, text, text);
drop function if exists public.attach_razorpay_order(uuid, text);
drop function if exists public.create_payment_order(uuid, uuid, text, boolean, text);

drop index if exists public.user_addons_payment_order_addon_key;
alter table public.user_addons drop column if exists payment_order_id;
drop index if exists public.user_plans_payment_order_id_key;
alter table public.user_plans drop column if exists payment_order_id;

drop table if exists public.payment_refunds;
drop table if exists public.payment_events;
drop table if exists public.payment_orders;

drop function if exists public.payment_sku_credits(text);
drop function if exists public.payment_sku_price_paise(text, boolean);
