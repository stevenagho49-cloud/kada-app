-- Fix: realtime.send() was called with the wrong argument order
-- (topic, event, payload, private) instead of (payload, event, topic, private),
-- so every insert/update/delete on public.invitations raised
-- "function realtime.send(unknown, text, jsonb, boolean) does not exist" and
-- the WHOLE WRITE WAS ROLLED BACK ,  invites were sent (email works) but never
-- recorded, so status never advanced and Resend never showed up.
-- Also wraps the broadcast in an exception handler so a future realtime hiccup
-- can never again silently kill an invitations write.
-- Idempotent — safe to run repeatedly. Apply via Supabase Dashboard > SQL Editor.

create or replace function public.broadcast_invitations_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  begin
    perform realtime.send(jsonb_build_object('id', coalesce(new.id, old.id)), tg_op, 'invitations-changes', true);
  exception when others then
    null; -- never let a broadcast failure block the actual invitations write
  end;
  return coalesce(new, old);
end;
$$;

notify pgrst, 'reload schema';
