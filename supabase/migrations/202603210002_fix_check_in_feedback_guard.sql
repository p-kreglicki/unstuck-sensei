CREATE OR REPLACE FUNCTION public.check_in_timer_session(
  input_session_id UUID,
  input_expected_revision INTEGER,
  input_checked_in_at TIMESTAMPTZ,
  input_feedback TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  latest_block public.session_timer_blocks%ROWTYPE;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer check-in.';
  END IF;

  IF input_feedback IS NULL
     OR input_feedback NOT IN ('yes', 'somewhat', 'no')
  THEN
    RAISE EXCEPTION 'Timer feedback must be yes, somewhat, or no.';
  END IF;

  SELECT *
  INTO session_row
  FROM public.sessions
  WHERE id = input_session_id
    AND user_id = request_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer session not found.';
  END IF;

  IF session_row.checked_in_at IS NOT NULL OR session_row.status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'sessionId', session_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.status = 'incomplete' THEN
    RETURN jsonb_build_object(
      'status', 'already_resolved',
      'sessionId', session_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  SELECT *
  INTO latest_block
  FROM public.session_timer_blocks
  WHERE session_id = input_session_id
  ORDER BY block_index DESC, created_at DESC
  LIMIT 1;

  IF NOT FOUND OR latest_block.ended_at IS NULL THEN
    RAISE EXCEPTION 'Timer check-in requires a completed timer block.';
  END IF;

  UPDATE public.sessions
  SET
    checked_in_at = input_checked_in_at,
    feedback = input_feedback,
    status = 'completed',
    timer_revision = timer_revision + 1
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'feedback', input_feedback,
    'checkedInAt', input_checked_in_at,
    'timerRevision', next_revision
  );
END;
$$;
