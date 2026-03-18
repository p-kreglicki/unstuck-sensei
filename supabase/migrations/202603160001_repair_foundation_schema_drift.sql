-- Repair projects that already have the Phase 1 tables from an earlier draft
-- of the foundation schema before the hardening changes in ec484e0.

-- ============================================
-- PROFILES
-- ============================================
ALTER TABLE public.profiles
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE public.profiles
SET created_at = NOW()
WHERE created_at IS NULL;

UPDATE public.profiles
SET updated_at = NOW()
WHERE updated_at IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname IN (
        'profiles_display_name_length_check',
        'profiles_display_name_check'
      )
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_display_name_length_check
      CHECK (char_length(display_name) <= 100) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_display_name_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      VALIDATE CONSTRAINT profiles_display_name_length_check;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile"
      ON public.profiles FOR INSERT
      TO authenticated
      WITH CHECK (id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can delete own profile'
  ) THEN
    CREATE POLICY "Users can delete own profile"
      ON public.profiles FOR DELETE
      TO authenticated
      USING (id = (SELECT auth.uid()));
  END IF;
END
$$;

-- ============================================
-- SESSIONS
-- ============================================
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

ALTER TABLE public.sessions
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET DEFAULT NOW();

UPDATE public.sessions
SET created_at = NOW()
WHERE created_at IS NULL;

UPDATE public.sessions
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;

ALTER TABLE public.sessions
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sessions'::regclass
      AND conname IN (
        'sessions_steps_is_array_check',
        'sessions_steps_check'
      )
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_steps_is_array_check
      CHECK (steps IS NULL OR jsonb_typeof(steps) = 'array') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.sessions'::regclass
      AND conname IN (
        'sessions_timer_duration_seconds_positive_check',
        'sessions_timer_duration_seconds_check'
      )
  ) THEN
    ALTER TABLE public.sessions
      ADD CONSTRAINT sessions_timer_duration_seconds_positive_check
      CHECK (timer_duration_seconds IS NULL OR timer_duration_seconds > 0) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_steps_is_array_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      VALIDATE CONSTRAINT sessions_steps_is_array_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_timer_duration_seconds_positive_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      VALIDATE CONSTRAINT sessions_timer_duration_seconds_positive_check;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'sessions'
      AND policyname = 'Users can delete own sessions'
  ) THEN
    CREATE POLICY "Users can delete own sessions"
      ON public.sessions FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id
  ON public.sessions USING btree (user_id);

-- ============================================
-- CONVERSATION_MESSAGES
-- ============================================
ALTER TABLE public.conversation_messages
  ALTER COLUMN created_at SET DEFAULT NOW();

UPDATE public.conversation_messages
SET created_at = NOW()
WHERE created_at IS NULL;

ALTER TABLE public.conversation_messages
  ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'conversation_messages'
      AND policyname = 'Users can delete own messages'
  ) THEN
    CREATE POLICY "Users can delete own messages"
      ON public.conversation_messages FOR DELETE
      TO authenticated
      USING (session_id IN (
        SELECT id FROM public.sessions WHERE user_id = (SELECT auth.uid())
      ));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_session_id
  ON public.conversation_messages USING btree (session_id);

-- ============================================
-- FUNCTIONS / TRIGGERS
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'profiles_updated_at'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    CREATE TRIGGER profiles_updated_at
      BEFORE UPDATE ON public.profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'sessions_updated_at'
      AND tgrelid = 'public.sessions'::regclass
  ) THEN
    CREATE TRIGGER sessions_updated_at
      BEFORE UPDATE ON public.sessions
      FOR EACH ROW
      EXECUTE FUNCTION public.update_updated_at();
  END IF;
END
$$;
