DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_display_name_length_check'
      AND conrelid = 'public.profiles'::regclass
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_display_name_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      DROP CONSTRAINT profiles_display_name_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_steps_is_array_check'
      AND conrelid = 'public.sessions'::regclass
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_steps_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      DROP CONSTRAINT sessions_steps_check;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_timer_duration_seconds_positive_check'
      AND conrelid = 'public.sessions'::regclass
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sessions_timer_duration_seconds_check'
      AND conrelid = 'public.sessions'::regclass
  ) THEN
    ALTER TABLE public.sessions
      DROP CONSTRAINT sessions_timer_duration_seconds_check;
  END IF;
END
$$;
