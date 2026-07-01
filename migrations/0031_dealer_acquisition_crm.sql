-- 0031_dealer_acquisition_crm.sql
-- Dealer Acquisition Command Center (V1). Additive only — extends
-- dealer_prospects with a separate CRM pipeline dimension + pilot/conversion
-- fields. Leaves the existing `status` column (which drives send eligibility)
-- untouched. Safe to re-run.

ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pipeline_status            text NOT NULL DEFAULT 'prospect_found';
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS next_follow_up_at          timestamptz;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS dealer_type                text;

-- Pilot metrics
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_start_date           timestamptz;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_end_date             timestamptz;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_lead_count           integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_texts_sent           integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_total_replies        integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_positive_replies     integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_appointments         integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_opt_outs             integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_bad_numbers          integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS pilot_sold_units_reported  integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS estimated_value_created    integer;

-- Conversion / MRR
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS monthly_price              integer;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS payment_status             text;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS converted_at               timestamptz;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS founder_pricing            boolean NOT NULL DEFAULT false;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS referral_asked             boolean NOT NULL DEFAULT false;
ALTER TABLE dealer_prospects ADD COLUMN IF NOT EXISTS referrals_given            integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS dealer_prospects_pipeline_status_idx ON dealer_prospects (pipeline_status);
CREATE INDEX IF NOT EXISTS dealer_prospects_next_follow_up_idx  ON dealer_prospects (next_follow_up_at);

-- One-time seed: any prospect we've already contacted (email batches set
-- last_contacted_at) should start at least at "Email 1 Sent" in the pipeline,
-- so the acquisition view reflects reality on first load. Only touches rows
-- still at the default stage.
UPDATE dealer_prospects
   SET pipeline_status = 'email_1_sent'
 WHERE last_contacted_at IS NOT NULL
   AND pipeline_status = 'prospect_found';
