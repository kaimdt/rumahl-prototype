-- Migration 038: User profiles (family / child profiles)
--
-- Extends `users` with a profile type and per-user restrictions so the
-- shell can support family profiles: children get a whitelist of allowed
-- apps while standard users stay unrestricted.
--
-- Design notes:
--   * `profile_type` – 'standard' (default) or 'child'. Other kinds (guest,
--     family) can be added later without schema churn.
--   * `restrictions` – JSONB policy bag. Currently consumed key:
--       { "allowed_app_ids": ["rumahl-files", ...] }
--     An empty array / missing key means "no app restrictions". Future keys:
--     allowed_page_ids, allowed_hours, content_ratings, ...
--   * Fields are read separately from the `users` row (not part of the
--     `User` struct) so existing queries keep working untouched.

ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE users ADD COLUMN IF NOT EXISTS restrictions JSONB NOT NULL DEFAULT '{}';
