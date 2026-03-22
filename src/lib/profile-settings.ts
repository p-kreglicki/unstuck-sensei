import type { Database } from "./database.types";
import { supabase } from "./supabase";

export type DetectionSensitivity = NonNullable<
  Database["public"]["Tables"]["profiles"]["Row"]["detection_sensitivity"]
>;

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

export type ProfileSettings = {
  createdAt: string;
  detectionEnabled: boolean;
  detectionSensitivity: DetectionSensitivity;
  displayName: string;
  emailEnabled: boolean;
  id: string;
  lastEmailSentAt: string | null;
  onboardingCompletedAt: string | null;
  preferredTime: string;
  timezone: string;
  updatedAt: string;
};

export type ProfileSettingsPatch = Partial<
  Pick<
    ProfileSettings,
    | "detectionEnabled"
    | "detectionSensitivity"
    | "displayName"
    | "emailEnabled"
    | "onboardingCompletedAt"
    | "preferredTime"
    | "timezone"
  >
>;

const PROFILE_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "display_name",
  "preferred_time",
  "timezone",
  "email_enabled",
  "detection_enabled",
  "detection_sensitivity",
  "last_email_sent_at",
  "onboarding_completed_at",
].join(", ");

export function hasCompletedOnboarding(profile: ProfileSettings) {
  return profile.onboardingCompletedAt !== null;
}

export function hasDetectionSettingsPatch(patch: ProfileSettingsPatch) {
  return (
    patch.detectionEnabled !== undefined ||
    patch.detectionSensitivity !== undefined
  );
}

export function normalizePreferredTime(value: string) {
  const trimmed = value.trim();

  if (/^\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00`;
  }

  return trimmed;
}

export function resolveLocalTimeZone() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
  return timezone && timezone.length > 0 ? timezone : "UTC";
}

export function toTimeInputValue(value: string | null | undefined) {
  if (!value) {
    return "09:00";
  }

  return value.slice(0, 5);
}

export function toProfileSettings(
  row: ProfileRow | null,
  userId: string,
): ProfileSettings {
  return {
    createdAt: row?.created_at ?? "",
    detectionEnabled: row?.detection_enabled ?? true,
    detectionSensitivity: row?.detection_sensitivity ?? "medium",
    displayName: row?.display_name ?? "",
    emailEnabled: row?.email_enabled ?? true,
    id: row?.id ?? userId,
    lastEmailSentAt: row?.last_email_sent_at ?? null,
    onboardingCompletedAt: row?.onboarding_completed_at ?? null,
    preferredTime: toTimeInputValue(row?.preferred_time),
    timezone: row?.timezone ?? resolveLocalTimeZone(),
    updatedAt: row?.updated_at ?? "",
  };
}

function toProfileUpdate(patch: ProfileSettingsPatch): ProfileUpdate {
  const update: ProfileUpdate = {};

  if (patch.detectionEnabled !== undefined) {
    update.detection_enabled = patch.detectionEnabled;
  }

  if (patch.detectionSensitivity !== undefined) {
    update.detection_sensitivity = patch.detectionSensitivity;
  }

  if (patch.displayName !== undefined) {
    update.display_name = patch.displayName;
  }

  if (patch.emailEnabled !== undefined) {
    update.email_enabled = patch.emailEnabled;
  }

  if (patch.onboardingCompletedAt !== undefined) {
    update.onboarding_completed_at = patch.onboardingCompletedAt;
  }

  if (patch.preferredTime !== undefined) {
    update.preferred_time = normalizePreferredTime(patch.preferredTime);
  }

  if (patch.timezone !== undefined) {
    update.timezone = patch.timezone;
  }

  return update;
}

export async function loadProfileSettings(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) {
    throw error;
  }

  return toProfileSettings(data, userId);
}

export async function saveProfileSettings(
  userId: string,
  patch: ProfileSettingsPatch,
) {
  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      ...toProfileUpdate(patch),
    })
    .select(PROFILE_COLUMNS)
    .single<ProfileRow>();

  if (error) {
    throw error;
  }

  return toProfileSettings(data, userId);
}
