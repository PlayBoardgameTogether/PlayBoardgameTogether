CREATE TABLE badge_definitions (
  id text PRIMARY KEY CHECK (id ~ '^custom-[a-z0-9][a-z0-9-]{0,63}$'),
  name text NOT NULL,
  description text NOT NULL,
  symbol text NOT NULL,
  enabled boolean NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  rule jsonb NOT NULL CHECK (jsonb_typeof(rule) = 'object'),
  created_by uuid NOT NULL REFERENCES accounts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE player_badge_grants DROP CONSTRAINT player_badge_grants_badge_id_check;
ALTER TABLE player_badge_grants ADD CONSTRAINT player_badge_grants_badge_id_check
  CHECK (badge_id IN ('beta-player', 'contributor', 'event-honor')
    OR badge_id ~ '^custom-[a-z0-9][a-z0-9-]{0,63}$');
