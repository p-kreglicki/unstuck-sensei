CREATE OR REPLACE FUNCTION public.consume_chat_rate_limit(input_session_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  hourly_count INTEGER;
  daily_count INTEGER;
  hourly_limit CONSTANT INTEGER := 12;
  daily_limit CONSTANT INTEGER := 40;
  reservation_id UUID;
BEGIN
  IF request_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthorized', 'reservationId', NULL);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(request_user_id::text, 0));

  DELETE FROM public.chat_request_logs
  WHERE user_id = request_user_id
    AND (
      (
        completed_at IS NOT NULL
        AND created_at < NOW() - INTERVAL '48 hours'
      )
      OR (
        completed_at IS NULL
        AND reservation_expires_at IS NOT NULL
        AND reservation_expires_at <= NOW()
      )
    );

  PERFORM 1
  FROM public.sessions
  WHERE id = input_session_id
    AND user_id = request_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid_session', 'reservationId', NULL);
  END IF;

  SELECT
    COUNT(*) FILTER (
      WHERE created_at >= NOW() - INTERVAL '1 hour'
    ),
    COUNT(*)
  INTO hourly_count, daily_count
  FROM public.chat_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '24 hours'
    AND (
      completed_at IS NOT NULL
      OR (
        reservation_expires_at IS NOT NULL
        AND reservation_expires_at > NOW()
      )
    );

  IF hourly_count >= hourly_limit OR daily_count >= daily_limit THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'reservationId', NULL);
  END IF;

  INSERT INTO public.chat_request_logs (session_id, user_id)
  VALUES (input_session_id, request_user_id)
  RETURNING id INTO reservation_id;

  RETURN jsonb_build_object('status', 'allowed', 'reservationId', reservation_id);
END;
$$;
