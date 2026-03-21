ALTER TABLE public.sessions
  ADD COLUMN checked_in_at TIMESTAMPTZ,
  ADD COLUMN timer_revision INTEGER NOT NULL DEFAULT 0;

CREATE TABLE public.session_timer_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  block_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT session_timer_blocks_block_index_positive
    CHECK (block_index > 0),
  CONSTRAINT session_timer_blocks_kind_check
    CHECK (kind IN ('initial', 'extension')),
  CONSTRAINT session_timer_blocks_duration_seconds_positive
    CHECK (duration_seconds > 0),
  CONSTRAINT session_timer_blocks_ended_after_started
    CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT session_timer_blocks_unique_session_block
    UNIQUE (session_id, block_index)
);

CREATE UNIQUE INDEX session_timer_blocks_one_extension_per_session
  ON public.session_timer_blocks (session_id)
  WHERE kind = 'extension';

CREATE INDEX idx_session_timer_blocks_session_id
  ON public.session_timer_blocks USING btree (session_id, block_index DESC, created_at DESC);

ALTER TABLE public.session_timer_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own timer blocks"
  ON public.session_timer_blocks FOR SELECT
  TO authenticated
  USING (
    session_id IN (
      SELECT id
      FROM public.sessions
      WHERE user_id = (SELECT auth.uid())
    )
  );

CREATE OR REPLACE FUNCTION public.start_timer_block(
  input_session_id UUID,
  input_expected_revision INTEGER,
  input_started_at TIMESTAMPTZ,
  input_duration_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  block_id UUID;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer start.';
  END IF;

  IF input_duration_seconds <= 0 THEN
    RAISE EXCEPTION 'Timer duration must be positive.';
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

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  IF session_row.timer_started_at IS NOT NULL THEN
    RAISE EXCEPTION 'Timer has already started for this session.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.session_timer_blocks
    WHERE session_id = input_session_id
  ) THEN
    RAISE EXCEPTION 'Timer blocks already exist for this session.';
  END IF;

  INSERT INTO public.session_timer_blocks (
    session_id,
    block_index,
    kind,
    started_at,
    duration_seconds
  )
  VALUES (
    input_session_id,
    1,
    'initial',
    input_started_at,
    input_duration_seconds
  )
  RETURNING id INTO block_id;

  UPDATE public.sessions
  SET
    checked_in_at = NULL,
    feedback = NULL,
    status = 'active',
    timer_duration_seconds = input_duration_seconds,
    timer_ended_at = NULL,
    timer_extended = FALSE,
    timer_revision = timer_revision + 1,
    timer_started_at = input_started_at
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'blockId', block_id,
    'startedAt', input_started_at,
    'durationSeconds', input_duration_seconds,
    'extended', FALSE,
    'timerRevision', next_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_timer_block(
  input_block_id UUID,
  input_expected_revision INTEGER,
  input_ended_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  block_row public.session_timer_blocks%ROWTYPE;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer completion.';
  END IF;

  SELECT blocks.*
  INTO block_row
  FROM public.session_timer_blocks AS blocks
  JOIN public.sessions AS sessions
    ON sessions.id = blocks.session_id
  WHERE blocks.id = input_block_id
    AND sessions.user_id = request_user_id
  FOR UPDATE OF sessions, blocks;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer block not found.';
  END IF;

  SELECT *
  INTO session_row
  FROM public.sessions
  WHERE id = block_row.session_id;

  IF block_row.ended_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'sessionId', session_row.id,
      'blockId', block_row.id,
      'endedAt', block_row.ended_at,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.checked_in_at IS NOT NULL OR session_row.status <> 'active' THEN
    RETURN jsonb_build_object(
      'status', 'already_resolved',
      'sessionId', session_row.id,
      'blockId', block_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  UPDATE public.session_timer_blocks
  SET ended_at = input_ended_at
  WHERE id = input_block_id;

  UPDATE public.sessions
  SET
    timer_ended_at = input_ended_at,
    timer_revision = timer_revision + 1
  WHERE id = session_row.id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', session_row.id,
    'blockId', block_row.id,
    'endedAt', input_ended_at,
    'timerRevision', next_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.start_extension_block(
  input_session_id UUID,
  input_expected_revision INTEGER,
  input_started_at TIMESTAMPTZ,
  input_duration_seconds INTEGER
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
  block_id UUID;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer extension.';
  END IF;

  IF input_duration_seconds <= 0 THEN
    RAISE EXCEPTION 'Timer duration must be positive.';
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

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  IF session_row.checked_in_at IS NOT NULL OR session_row.status <> 'active' THEN
    RAISE EXCEPTION 'Timer check-in has already been resolved.';
  END IF;

  IF session_row.timer_extended IS TRUE THEN
    RAISE EXCEPTION 'Timer extension already used.';
  END IF;

  SELECT *
  INTO latest_block
  FROM public.session_timer_blocks
  WHERE session_id = input_session_id
  ORDER BY block_index DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR latest_block.ended_at IS NULL THEN
    RAISE EXCEPTION 'Timer extension requires a completed timer block.';
  END IF;

  INSERT INTO public.session_timer_blocks (
    session_id,
    block_index,
    kind,
    started_at,
    duration_seconds
  )
  VALUES (
    input_session_id,
    latest_block.block_index + 1,
    'extension',
    input_started_at,
    input_duration_seconds
  )
  RETURNING id INTO block_id;

  UPDATE public.sessions
  SET
    timer_duration_seconds = COALESCE(timer_duration_seconds, 0) + input_duration_seconds,
    timer_ended_at = NULL,
    timer_extended = TRUE,
    timer_revision = timer_revision + 1
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'blockId', block_id,
    'startedAt', input_started_at,
    'durationSeconds', input_duration_seconds,
    'extended', TRUE,
    'timerRevision', next_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.stop_timer_block(
  input_block_id UUID,
  input_expected_revision INTEGER,
  input_ended_at TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  block_row public.session_timer_blocks%ROWTYPE;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer stop.';
  END IF;

  SELECT blocks.*
  INTO block_row
  FROM public.session_timer_blocks AS blocks
  JOIN public.sessions AS sessions
    ON sessions.id = blocks.session_id
  WHERE blocks.id = input_block_id
    AND sessions.user_id = request_user_id
  FOR UPDATE OF sessions, blocks;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Timer block not found.';
  END IF;

  SELECT *
  INTO session_row
  FROM public.sessions
  WHERE id = block_row.session_id;

  IF session_row.status = 'incomplete' THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'sessionId', session_row.id,
      'blockId', block_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.checked_in_at IS NOT NULL OR session_row.status = 'completed' THEN
    RETURN jsonb_build_object(
      'status', 'already_resolved',
      'sessionId', session_row.id,
      'blockId', block_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  UPDATE public.session_timer_blocks
  SET ended_at = COALESCE(ended_at, input_ended_at)
  WHERE id = input_block_id;

  UPDATE public.sessions
  SET
    status = 'incomplete',
    timer_ended_at = input_ended_at,
    timer_revision = timer_revision + 1
  WHERE id = session_row.id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', session_row.id,
    'blockId', block_row.id,
    'endedAt', input_ended_at,
    'timerRevision', next_revision
  );
END;
$$;

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

  IF input_feedback NOT IN ('yes', 'somewhat', 'no') THEN
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

CREATE OR REPLACE FUNCTION public.expire_timer_checkin(
  input_session_id UUID,
  input_expected_revision INTEGER,
  input_expired_at TIMESTAMPTZ
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
    RAISE EXCEPTION 'Unauthorized timer expiry.';
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

  IF session_row.status = 'incomplete' THEN
    RETURN jsonb_build_object(
      'status', 'already_applied',
      'sessionId', session_row.id,
      'timerRevision', session_row.timer_revision
    );
  END IF;

  IF session_row.checked_in_at IS NOT NULL OR session_row.status = 'completed' THEN
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
    RAISE EXCEPTION 'Timer expiry requires a completed timer block.';
  END IF;

  IF latest_block.ended_at > input_expired_at THEN
    RAISE EXCEPTION 'Timer expiry cannot happen before the latest block ended.';
  END IF;

  UPDATE public.sessions
  SET
    status = 'incomplete',
    timer_revision = timer_revision + 1
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'expiredAt', input_expired_at,
    'timerRevision', next_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_timer_start(
  input_session_id UUID,
  input_expected_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  initial_block public.session_timer_blocks%ROWTYPE;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized timer revert.';
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

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  IF
    session_row.checked_in_at IS NOT NULL
    OR session_row.status <> 'active'
    OR session_row.timer_started_at IS NULL
    OR session_row.timer_ended_at IS NOT NULL
    OR COALESCE(session_row.timer_extended, FALSE)
  THEN
    RAISE EXCEPTION 'Timer start revert requires the session to still be in its just-started state.';
  END IF;

  SELECT *
  INTO initial_block
  FROM public.session_timer_blocks
  WHERE session_id = input_session_id
  ORDER BY block_index DESC, created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND
     OR initial_block.kind <> 'initial'
     OR initial_block.ended_at IS NOT NULL
  THEN
    RAISE EXCEPTION 'Timer start revert requires exactly one open initial timer block.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.session_timer_blocks
    WHERE session_id = input_session_id
      AND id <> initial_block.id
  ) THEN
    RAISE EXCEPTION 'Timer start revert only supports the initial timer block.';
  END IF;

  DELETE FROM public.session_timer_blocks
  WHERE id = initial_block.id;

  UPDATE public.sessions
  SET
    checked_in_at = NULL,
    feedback = NULL,
    timer_duration_seconds = NULL,
    timer_ended_at = NULL,
    timer_extended = FALSE,
    timer_revision = timer_revision + 1,
    timer_started_at = NULL
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'timerRevision', next_revision
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_extension_start(
  input_session_id UUID,
  input_expected_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  request_user_id UUID := (SELECT auth.uid());
  session_row public.sessions%ROWTYPE;
  prior_block public.session_timer_blocks%ROWTYPE;
  next_revision INTEGER;
BEGIN
  IF request_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized extension revert.';
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

  IF session_row.timer_revision <> input_expected_revision THEN
    RAISE EXCEPTION 'Timer revision mismatch.';
  END IF;

  DELETE FROM public.session_timer_blocks
  WHERE session_id = input_session_id
    AND kind = 'extension';

  SELECT *
  INTO prior_block
  FROM public.session_timer_blocks
  WHERE session_id = input_session_id
  ORDER BY block_index DESC, created_at DESC
  LIMIT 1;

  UPDATE public.sessions
  SET
    timer_duration_seconds = COALESCE(prior_block.duration_seconds, timer_duration_seconds),
    timer_ended_at = prior_block.ended_at,
    timer_extended = FALSE,
    timer_revision = timer_revision + 1
  WHERE id = input_session_id
  RETURNING timer_revision INTO next_revision;

  RETURN jsonb_build_object(
    'status', 'ok',
    'sessionId', input_session_id,
    'timerRevision', next_revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_timer_block(UUID, INTEGER, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_timer_block(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_extension_block(UUID, INTEGER, TIMESTAMPTZ, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.stop_timer_block(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in_timer_session(UUID, INTEGER, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_timer_checkin(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_timer_start(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revert_extension_start(UUID, INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.start_timer_block(UUID, INTEGER, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_timer_block(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_extension_block(UUID, INTEGER, TIMESTAMPTZ, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.stop_timer_block(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in_timer_session(UUID, INTEGER, TIMESTAMPTZ, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_timer_checkin(UUID, INTEGER, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_timer_start(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revert_extension_start(UUID, INTEGER) TO authenticated;
