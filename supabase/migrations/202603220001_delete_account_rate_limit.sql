CREATE TABLE IF NOT EXISTS public.account_delete_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_delete_request_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS account_delete_request_logs_user_created_idx
  ON public.account_delete_request_logs (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.consume_delete_account_rate_limit()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  hourly_count INTEGER;
  daily_count INTEGER;
  hourly_limit CONSTANT INTEGER := 3;
  daily_limit CONSTANT INTEGER := 10;
BEGIN
  IF request_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(request_user_id::text, 1));

  DELETE FROM public.account_delete_request_logs
  WHERE user_id = request_user_id
    AND created_at < NOW() - INTERVAL '24 hours';

  SELECT COUNT(*)
  INTO hourly_count
  FROM public.account_delete_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '1 hour';

  SELECT COUNT(*)
  INTO daily_count
  FROM public.account_delete_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF hourly_count >= hourly_limit OR daily_count >= daily_limit THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  INSERT INTO public.account_delete_request_logs (user_id)
  VALUES (request_user_id);

  RETURN jsonb_build_object('status', 'allowed');
END;
$$;

REVOKE ALL ON FUNCTION public.consume_delete_account_rate_limit() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.consume_delete_account_rate_limit() TO authenticated;
