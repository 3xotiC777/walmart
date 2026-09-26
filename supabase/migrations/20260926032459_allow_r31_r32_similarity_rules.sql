-- Admit only the two new similarity rules while preserving every existing rule code.
alter table public.conflict_groups
  drop constraint conflict_groups_rule_code_check;

alter table public.conflict_groups
  add constraint conflict_groups_rule_code_check
  check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9]|3[0-2])|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$')
  not valid;

alter table public.validation_alerts
  drop constraint validation_alerts_rule_code_check;

alter table public.validation_alerts
  add constraint validation_alerts_rule_code_check
  check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9]|3[0-2])|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$')
  not valid;

alter table public.conflict_groups
  validate constraint conflict_groups_rule_code_check;

alter table public.validation_alerts
  validate constraint validation_alerts_rule_code_check;
