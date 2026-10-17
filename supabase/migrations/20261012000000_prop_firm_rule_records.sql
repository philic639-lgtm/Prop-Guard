-- Prop-firm rules: per-rule evidence.
-- Each rule version carries one record per rule (value, status, official
-- sources with title and check date). Only records with status 'verified' are
-- applied in the app; 'needs_review' marks conflicting / unclear sources.
-- Account snapshots of the rules used at save time live in accounts.firm_link.

alter table public.prop_firm_rule_versions
  add column if not exists records jsonb not null default '[]'::jsonb;

alter table public.prop_firm_rule_versions
  drop constraint if exists prop_firm_rule_versions_records_array;
alter table public.prop_firm_rule_versions
  add constraint prop_firm_rule_versions_records_array check (jsonb_typeof(records) = 'array');
