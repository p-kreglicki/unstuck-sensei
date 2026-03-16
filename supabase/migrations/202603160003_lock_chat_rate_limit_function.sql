DROP FUNCTION IF EXISTS public.consume_chat_rate_limit(UUID, INTEGER, INTEGER);

CREATE FUNCTION public.consume_chat_rate_limit(input_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  hourly_count INTEGER;
  daily_count INTEGER;
  hourly_limit CONSTANT INTEGER := 12;
  daily_limit CONSTANT INTEGER := 40;
BEGIN
  IF request_user_id IS NULL THEN
    RETURN 'unauthorized';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(request_user_id::text, 0));

  PERFORM 1
  FROM public.sessions
  WHERE id = input_session_id
    AND user_id = request_user_id;

  IF NOT FOUND THEN
    RETURN 'invalid_session';
  END IF;

  SELECT COUNT(*)
  INTO hourly_count
  FROM public.chat_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '1 hour';

  SELECT COUNT(*)
  INTO daily_count
  FROM public.chat_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '24 hours';

  IF hourly_count >= hourly_limit OR daily_count >= daily_limit THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.chat_request_logs (session_id, user_id)
  VALUES (input_session_id, request_user_id);

  RETURN 'allowed';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chat_rate_limit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_chat_rate_limit(UUID) TO authenticated;
