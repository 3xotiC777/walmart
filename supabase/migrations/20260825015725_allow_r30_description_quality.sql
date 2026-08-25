-- Permit the new R30 description-quality rule without widening the accepted
-- code space to future/unknown numeric rules.
alter table public.conflict_groups
  drop constraint conflict_groups_rule_code_check;

alter table public.conflict_groups
  add constraint conflict_groups_rule_code_check
  check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9]|30)|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$')
  not valid;

alter table public.conflict_groups
  validate constraint conflict_groups_rule_code_check;

alter table public.validation_alerts
  drop constraint validation_alerts_rule_code_check;

alter table public.validation_alerts
  add constraint validation_alerts_rule_code_check
  check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9]|30)|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$')
  not valid;

alter table public.validation_alerts
  validate constraint validation_alerts_rule_code_check;
