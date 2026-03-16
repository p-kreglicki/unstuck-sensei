DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_stuck_on_length_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_stuck_on_length_check
      CHECK (stuck_on IS NULL OR char_length(stuck_on) <= 2000) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_clarifying_answer_length_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_clarifying_answer_length_check
      CHECK (
        clarifying_answer IS NULL OR char_length(clarifying_answer) <= 1000
      ) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.sessions
  VALIDATE CONSTRAINT sessions_stuck_on_length_check;

ALTER TABLE public.sessions
  VALIDATE CONSTRAINT sessions_clarifying_answer_length_check;

CREATE TABLE IF NOT EXISTS public.chat_request_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_request_logs_user_id_created_at
  ON public.chat_request_logs USING btree (user_id, created_at DESC);

ALTER TABLE public.chat_request_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_request_logs'
      AND policyname = 'Users can view own chat request logs'
  ) THEN
    CREATE POLICY "Users can view own chat request logs"
      ON public.chat_request_logs FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'chat_request_logs'
      AND policyname = 'Users can insert own chat request logs'
  ) THEN
    CREATE POLICY "Users can insert own chat request logs"
      ON public.chat_request_logs FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND session_id IN (
          SELECT id
          FROM public.sessions
          WHERE user_id = (SELECT auth.uid())
        )
      );
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.consume_chat_rate_limit(
  input_session_id UUID,
  input_hourly_limit INTEGER,
  input_daily_limit INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  hourly_count INTEGER;
  daily_count INTEGER;
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

  IF hourly_count >= input_hourly_limit OR daily_count >= input_daily_limit THEN
    RETURN 'rate_limited';
  END IF;

  INSERT INTO public.chat_request_logs (session_id, user_id)
  VALUES (input_session_id, request_user_id);

  RETURN 'allowed';
END;
$$;

REVOKE ALL ON FUNCTION public.consume_chat_rate_limit(UUID, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consume_chat_rate_limit(UUID, INTEGER, INTEGER) TO authenticated;
