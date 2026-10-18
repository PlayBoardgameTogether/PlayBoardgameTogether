-- Existing offers and receipts retain fixed action pricing; new offers may opt into token billing.
ALTER TABLE official_ai_offers ADD COLUMN token_pricing jsonb;
ALTER TABLE official_ai_offers ADD CONSTRAINT official_ai_token_pricing_shape CHECK (
  token_pricing IS NULL OR (
    jsonb_typeof(token_pricing) = 'object'
    AND token_pricing ?& ARRAY['inputPointsPerMillion','outputPointsPerMillion','markupPercent']
    AND (token_pricing->>'inputPointsPerMillion')::numeric BETWEEN 0 AND 1000000000
    AND (token_pricing->>'outputPointsPerMillion')::numeric BETWEEN 0 AND 1000000000
    AND (token_pricing->>'markupPercent')::numeric BETWEEN 0 AND 1000
    AND (token_pricing->>'inputPointsPerMillion')::numeric = trunc((token_pricing->>'inputPointsPerMillion')::numeric)
    AND (token_pricing->>'outputPointsPerMillion')::numeric = trunc((token_pricing->>'outputPointsPerMillion')::numeric)
    AND (token_pricing->>'markupPercent')::numeric = trunc((token_pricing->>'markupPercent')::numeric)
    AND (token_pricing->>'inputPointsPerMillion')::numeric + (token_pricing->>'outputPointsPerMillion')::numeric > 0
  ) IS TRUE
);
ALTER TABLE official_ai_reservations DROP CONSTRAINT official_ai_reservations_points_check;
ALTER TABLE official_ai_reservations ADD CONSTRAINT official_ai_reservations_points_check CHECK (points >= 0);
ALTER TABLE official_ai_reservations ADD COLUMN token_billing jsonb;
ALTER TABLE ai_point_ledger ADD COLUMN token_billing jsonb;
