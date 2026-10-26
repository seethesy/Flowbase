-- Custom SQL migration file, put your code below! --
-- Auth calls this before inserting auth.users. This custom Drizzle migration
-- works on the disposable CI database too (which has no Supabase auth roles).
CREATE FUNCTION public.flowbase_before_user_created(event jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(event->'user'->'app_metadata'->>'provider', '') NOT IN ('google', 'email')
    OR NOT EXISTS (
      SELECT 1 FROM public.users
      WHERE lower(email) = lower(event->'user'->>'email')
        AND status = 'pending' AND archived_at IS NULL
    ) THEN
    RETURN jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'This account is not invited. Contact your Flowbase Admin.'
    ));
  END IF;
  RETURN '{}'::jsonb;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.flowbase_before_user_created(jsonb) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
    GRANT EXECUTE ON FUNCTION public.flowbase_before_user_created(jsonb) TO supabase_auth_admin;
  END IF;
END $$;
