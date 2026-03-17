ALTER TABLE public.chat_request_logs
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reservation_expires_at TIMESTAMPTZ;

UPDATE public.chat_request_logs
SET completed_at = created_at,
    reservation_expires_at = NULL
WHERE completed_at IS NULL
  AND reservation_expires_at IS NULL;

ALTER TABLE public.chat_request_logs
  ALTER COLUMN reservation_expires_at
  SET DEFAULT NOW() + INTERVAL '10 minutes';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_request_logs_state_check'
      AND conrelid = 'public.chat_request_logs'::regclass
  ) THEN
    ALTER TABLE public.chat_request_logs
      ADD CONSTRAINT chat_request_logs_state_check
      CHECK (
        (
          completed_at IS NULL
          AND reservation_expires_at IS NOT NULL
        )
        OR (
          completed_at IS NOT NULL
          AND reservation_expires_at IS NULL
        )
      ) NOT VALID;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chat_request_logs_state_check'
      AND conrelid = 'public.chat_request_logs'::regclass
  ) THEN
    ALTER TABLE public.chat_request_logs
      VALIDATE CONSTRAINT chat_request_logs_state_check;
  END IF;
END
$$;

DROP FUNCTION IF EXISTS public.consume_chat_rate_limit(UUID);

CREATE FUNCTION public.consume_chat_rate_limit(input_session_id UUID)
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

  SELECT COUNT(*)
  INTO hourly_count
  FROM public.chat_request_logs
  WHERE user_id = request_user_id
    AND created_at >= NOW() - INTERVAL '1 hour'
    AND (
      completed_at IS NOT NULL
      OR (
        reservation_expires_at IS NOT NULL
        AND reservation_expires_at > NOW()
      )
    );

  SELECT COUNT(*)
  INTO daily_count
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

CREATE OR REPLACE FUNCTION public.complete_chat_rate_limit_reservation(
  input_log_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
BEGIN
  IF request_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  UPDATE public.chat_request_logs
  SET completed_at = NOW(),
      reservation_expires_at = NULL
  WHERE id = input_log_id
    AND user_id = request_user_id
    AND completed_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_chat_rate_limit_reservation(
  input_log_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
BEGIN
  IF request_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  DELETE FROM public.chat_request_logs
  WHERE id = input_log_id
    AND user_id = request_user_id
    AND completed_at IS NULL;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chat_rate_limit(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_chat_rate_limit_reservation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_chat_rate_limit_reservation(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.consume_chat_rate_limit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_chat_rate_limit_reservation(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_chat_rate_limit_reservation(UUID) TO authenticated;
